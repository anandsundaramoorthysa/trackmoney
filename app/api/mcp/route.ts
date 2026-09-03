import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";

import { purchaseAsAgent, purchaseTerms } from "@/lib/agent-commerce";
import { handleRouteError } from "@/lib/api-errors";
import { db } from "@/lib/db";
import { planConfig } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * TrackMoney as an MCP server.
 *
 * The track asks for a merchant that an AI buyer can transact with end to end.
 * The REST endpoint answers that for a buyer written against x402; this answers
 * it for the interface assistants actually speak, and which Razorpay itself
 * ships a server for. An assistant can be pointed here and buy, with no code
 * written for our particular API.
 *
 * Every rule is the one in lib/agent-commerce.ts, shared with the REST route.
 * This file translates JSON-RPC to that function and back, and decides nothing.
 *
 * Transport note: this is the plain HTTP half of MCP's Streamable HTTP — a POST
 * carrying one JSON-RPC request and returning one JSON-RPC response. There is
 * no SSE stream, because nothing here is long-running or server-initiated, and
 * a stream that never streams is a moving part with no purpose.
 */

const PROTOCOL_VERSION = "2025-06-18";

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

function ok(id: JsonRpcRequest["id"], result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function rpcError(
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
  status = 200,
) {
  // JSON-RPC carries its own errors in a 200 body; the status only moves for
  // things that went wrong before the envelope was understood.
  return NextResponse.json(
    { jsonrpc: "2.0", id: id ?? null, error: { code, message } },
    { status },
  );
}

/**
 * Tool results are text, and the text is what the model reads.
 *
 * So a refusal has to explain itself in the same breath — an assistant that is
 * told only "false" will try again the same way. `isError` marks it as a
 * failure for the client; the sentence tells the model what would work.
 */
function toolResult(text: string, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

const TOOLS = [
  {
    name: "list_products",
    description:
      "What this merchant sells: id, price in paise, currency, and what each plan includes.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_purchase_terms",
    description:
      "What is required to buy, and a single-use payment challenge to quote back. Call this before buy_product.",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string", description: 'Defaults to "pro".' },
      },
      additionalProperties: false,
    },
  },
  {
    name: "buy_product",
    description:
      "Create a Razorpay test-mode order using a purchase mandate the account holder issued. This never captures payment: a person authorises the order in Razorpay's own checkout.",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string" },
        mandate: {
          type: "string",
          description: "The purchase mandate token, issued from /billing.",
        },
        challenge: {
          type: "string",
          description: "The nonce from get_purchase_terms.",
        },
        maxAmountMinor: {
          type: "integer",
          description:
            "The most this buyer may spend, in paise. Honoured: a dearer product is refused.",
        },
      },
      required: ["mandate", "challenge"],
      additionalProperties: false,
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>) {
  if (name === "list_products") {
    const rows = await db
      .select()
      .from(planConfig)
      .orderBy(desc(planConfig.pricePaise));

    return toolResult(
      JSON.stringify(
        {
          merchant: "TrackMoney",
          processor: "razorpay",
          mode: "test",
          currency: "INR",
          minorUnit: "paise",
          products: rows.map((row) => ({
            id: row.plan,
            name: `TrackMoney ${row.label}`,
            priceMinor: row.pricePaise,
            purchasable: row.pricePaise > 0,
            features: row.features,
          })),
        },
        null,
        2,
      ),
    );
  }

  if (name === "get_purchase_terms") {
    const productId = String(args.productId ?? "pro");
    const terms = await purchaseTerms(productId);
    // Same answer as the HTTP transport: no terms exist for a product we do
    // not sell, and inventing a null price for one helps nobody.
    if (!terms) {
      return toolResult(
        `No purchasable product with id "${productId}". Call list_products to see what is on sale.`,
        true,
      );
    }
    return toolResult(JSON.stringify(terms, null, 2));
  }

  if (name === "buy_product") {
    const mandate = typeof args.mandate === "string" ? args.mandate : "";
    const challenge = typeof args.challenge === "string" ? args.challenge : "";

    if (!mandate || !challenge) {
      return toolResult(
        "Both a mandate and a challenge are required. Call get_purchase_terms for a challenge; the mandate is issued by the account holder at /billing.",
        true,
      );
    }

    const result = await purchaseAsAgent({
      token: mandate,
      productId: String(args.productId ?? "pro"),
      maxAmountMinor:
        typeof args.maxAmountMinor === "number" ? args.maxAmountMinor : undefined,
      nonce: challenge,
    });

    if (!result.ok) {
      return toolResult(
        `Refused (${result.refusedBecause}): ${result.message}`,
        true,
      );
    }

    return toolResult(
      JSON.stringify(
        {
          orderId: result.orderId,
          amountMinor: result.amountMinor,
          currency: result.currency,
          reused: result.reused,
          cart: result.cart,
          settlement:
            "A person authorises this order in Razorpay's own checkout. Nothing here captured payment, and nothing here can.",
        },
        null,
        2,
      ),
    );
  }

  return toolResult(`No tool named "${name}".`, true);
}

async function handlePOST(request: Request) {
  let body: JsonRpcRequest;
  try {
    body = await request.json();
  } catch {
    return rpcError(null, -32700, "Parse error: the body is not JSON.", 400);
  }

  const { id, method, params } = body;

  if (method === "initialize") {
    return ok(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "trackmoney", version: "1.0.0" },
      instructions:
        "TrackMoney sells one thing: a Pro upgrade, in Razorpay test mode. Call get_purchase_terms for a challenge, then buy_product with a mandate the account holder issued. No tool here can move money.",
    });
  }

  // Notifications carry no id and expect no reply.
  if (method === "notifications/initialized") {
    return new NextResponse(null, { status: 202 });
  }

  if (method === "tools/list") {
    return ok(id, { tools: TOOLS });
  }

  if (method === "tools/call") {
    const name = String(params?.name ?? "");
    const args = (params?.arguments ?? {}) as Record<string, unknown>;
    return ok(id, await callTool(name, args));
  }

  if (method === "ping") return ok(id, {});

  return rpcError(id, -32601, `Unknown method "${method ?? ""}".`);
}

export async function POST(request: Request) {
  try {
    return await handlePOST(request);
  } catch (error) {
    return handleRouteError(error);
  }
}

/** A GET is how people check a server is there; say what it is. */
export async function GET() {
  return NextResponse.json({
    name: "trackmoney",
    transport: "mcp/streamable-http (POST only)",
    protocolVersion: PROTOCOL_VERSION,
    tools: TOOLS.map((tool) => tool.name),
    note: "POST JSON-RPC 2.0 here. Every rule is shared with /api/agent-commerce/orders; neither transport enforces its own.",
  });
}
