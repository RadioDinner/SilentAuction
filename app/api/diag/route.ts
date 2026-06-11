import { getDiagnostics } from "@/lib/sheets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const diag = await getDiagnostics();
  return new Response(JSON.stringify(diag, null, 2), {
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store, max-age=0",
    },
  });
}
