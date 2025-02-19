// Importar módulos necesarios
import { serve } from "https://deno.land/std@0.181.0/http/server.ts";

// 📌 Servidor HTTP en Deno Deploy
serve(async (req) => {
  if (req.method === "POST") {
    console.log("🚀 Iniciando backup...");

    try {
      // 📌 Leer credenciales de la variable de entorno
      const credentials = JSON.parse(Deno.env.get("GOOGLE_CLOUD_CREDENTIALS") || "{}");

      if (!credentials.client_email || !credentials.private_key) {
        throw new Error("❌ Credenciales de Google Cloud no encontradas.");
      }

      console.log("✅ Credenciales cargadas correctamente:", credentials.client_email);

      // 📌 Obtener token OAuth
      const token = await obtenerTokenOAuth(credentials);

      console.log("🔑 Token OAuth generado correctamente:", token);

      return new Response("✅ Backup iniciado en Deno Deploy", { status: 200 });
    } catch (error) {
      console.error("❌ Error en el backup:", error);
      return new Response(`❌ Error: ${error.message}`, { status: 500 });
    }
  }

  return new Response("⛔ Método no permitido", { status: 405 });
});
