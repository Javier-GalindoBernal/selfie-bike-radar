import { NextResponse, connection } from "next/server";
import { publicKeyValid } from "@/lib/radar";
export async function GET() {
  await connection();
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  return NextResponse.json({
    url: process.env.SUPABASE_URL || "",
    key: publicKeyValid(key) ? key : "",
  }, {headers: {"Cache-Control":"no-store"}});
}
