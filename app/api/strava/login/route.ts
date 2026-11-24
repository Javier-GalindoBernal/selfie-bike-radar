import { NextResponse } from "next/server";
const gone = () => NextResponse.json({error:"Esta ruta del prototipo fue retirada. Usa la app independiente con tu cuenta."},{status:410});
export const GET = gone;
export const POST = gone;
