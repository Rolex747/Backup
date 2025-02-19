import { serve } from "https://deno.land/std/http/server.ts";

// Servidor HTTP para recibir peticiones
serve(async (req) => {
  if (req.method === "POST") {
    console.log("🚀 Iniciando backup...");
    return new Response("✅ Backup completado en Deno Deploy", { status: 200 });
  }

  return new Response("❌ Método no permitido", { status: 405 });
});
