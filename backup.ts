// 📌 Importar el módulo de servidor HTTP de Deno
import { serve } from "https://deno.land/std@0.181.0/http/server.ts";

// 📌 Iniciar el servidor en Deno Deploy
serve(async (req) => {
  if (req.method === "POST") {
    console.log("🚀 Iniciando backup...");

    try {
      // 📌 Leer credenciales desde la variable de entorno en Deno Deploy
      const credentials = JSON.parse(Deno.env.get("GOOGLE_CLOUD_CREDENTIALS") || "{}");

      if (!credentials.client_email || !credentials.private_key) {
        throw new Error("❌ Credenciales de Google Cloud no encontradas.");
      }

      console.log("✅ Credenciales cargadas correctamente:", credentials.client_email);

      // 📌 Obtener el token OAuth
      const token = await obtenerTokenOAuth(credentials);
      console.log("🔑 Token OAuth generado correctamente:", token);

      // 📌 Intentar listar archivos en el bucket
      const bucketName = "backups-drive-feasy";
      const archivos = await listarArchivosEnBucket(bucketName, token);

      if (!archivos || archivos.error) {
        console.error("❌ Error al acceder al bucket:", archivos);
        throw new Error(`Error en acceso al bucket: ${JSON.stringify(archivos)}`);
      }

      console.log("📂 Archivos en el bucket:", JSON.stringify(archivos));

      return new Response(
        JSON.stringify({ message: "✅ Backup completado en Deno Deploy", files: archivos }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (error) {
      console.error("❌ Error en el backup:", error);

      // ✅ Manejo seguro del error para evitar TypeError
      const errorMessage = error instanceof Error ? error.message : "Error desconocido";

      return new Response(
        JSON.stringify({ error: errorMessage }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  return new Response("⛔ Método no permitido", { status: 405 });
});

// 📌 Función para generar el token OAuth con la cuenta de servicio
async function obtenerTokenOAuth(credentials: any): Promise<string> {
  try {
    const header = {
      alg: "RS256",
      typ: "JWT",
    };

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: credentials.client_email,
      scope: "https://www.googleapis.com/auth/devstorage.full_control",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    };

    // 📌 Convertir a Base64
    const encodeBase64 = (obj: any) => btoa(JSON.stringify(obj));
    const encodedHeader = encodeBase64(header);
    const encodedPayload = encodeBase64(payload);

    const data = `${encodedHeader}.${encodedPayload}`;

    // 📌 Firmar el token con la clave privada
    const encoder = new TextEncoder();
    const keyBuffer = encoder.encode(credentials.private_key.replace(/\\n/g, "\n"));

    const cryptoKey = await crypto.subtle.importKey(
      "pkcs8",
      keyBuffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, encoder.encode(data));
    const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)));

    const jwt = `${data}.${encodedSignature}`;

    // 📌 Obtener el Token de Acceso desde Google OAuth
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    const result = await response.json();
    if (!result.access_token) throw new Error("❌ No se pudo obtener el token OAuth.");

    return result.access_token;
  } catch (error) {
    console.error("❌ Error al generar token OAuth:", error);
    throw new Error("No se pudo generar el token OAuth.");
  }
}

// 📌 Función para listar archivos en un bucket de Google Cloud Storage
async function listarArchivosEnBucket(bucketName: string, token: string) {
  try {
    const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucketName}/o`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const result = await response.json();
    if (result.error) {
      console.error("❌ Error en respuesta del bucket:", result);
      throw new Error(`Error en bucket: ${result.error.message}`);
    }

    return result;
  } catch (error) {
    console.error("❌ Error al listar archivos en el bucket:", error);
    throw new Error("No se pudo acceder a los archivos del bucket.");
  }
}
