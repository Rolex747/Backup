// 📌 Importar módulos necesarios
import { serve } from "https://deno.land/std@0.181.0/http/server.ts";

// 📌 Configurar constantes
const GOOGLE_DRIVE_FOLDER_ID = "1LT7ddkv2GomrY7JfymBwK6YZJXtlKufz"; // 📂 ID de la carpeta de Drive a respaldar
const BUCKET_NAME = "backups-drive-feasy"; // 📦 Nombre del bucket de Google Cloud Storage

// 📌 Iniciar el servidor en Deno Deploy
serve(async (req) => {
  if (req.method === "POST") {
    console.log("🚀 Iniciando backup de Google Sheets en Drive...");

    try {
      // 📌 Leer credenciales desde la variable de entorno en Deno Deploy
      const credentials = JSON.parse(Deno.env.get("GOOGLE_CLOUD_CREDENTIALS") || "{}");

      if (!credentials.client_email || !credentials.private_key) {
        throw new Error("❌ Credenciales de Google Cloud no encontradas.");
      }

      console.log("✅ Credenciales cargadas correctamente:", credentials.client_email);

      // 📌 Obtener el token OAuth
      const token = await obtenerTokenOAuth(credentials);
      console.log("🔑 Token OAuth generado correctamente.");

      // 📌 Obtener lista de archivos en la carpeta de Google Drive
      const archivos = await obtenerArchivosEnCarpeta(GOOGLE_DRIVE_FOLDER_ID, token);

      if (!archivos || archivos.length === 0) {
        throw new Error("❌ No se encontraron archivos Google Sheets en la carpeta.");
      }

      console.log(`📂 Se encontraron ${archivos.length} Google Sheets. Iniciando conversión...`);

      // 📌 Convertir y subir cada archivo
      for (const archivo of archivos) {
        await convertirYSubirArchivo(archivo, token);
      }

      return new Response(JSON.stringify({ message: "✅ Backup completado correctamente" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("❌ Error en el backup:", error);
      return new Response(JSON.stringify({ error: error.message || "Error desconocido" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  return new Response("⛔ Método no permitido", { status: 405 });
});

// 📌 Función para obtener el token OAuth con la cuenta de servicio
async function obtenerTokenOAuth(credentials: any): Promise<string> {
  try {
    console.log("🛠️ Generando JWT...");

    const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = btoa(
      JSON.stringify({
        iss: credentials.client_email,
        scope: "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/devstorage.full_control",
        aud: "https://oauth2.googleapis.com/token",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    );

    const data = `${header}.${payload}`;

    console.log("🔏 Procesando la clave privada...");
    
    // 📌 Decodificar la clave privada
    const pemKey = credentials.private_key
      .replace(/\\n/g, "\n") // Convertir saltos de línea codificados
      .replace("-----BEGIN PRIVATE KEY-----\n", "") // Eliminar encabezado
      .replace("\n-----END PRIVATE KEY-----", "") // Eliminar pie de firma
      .replace(/\n/g, ""); // Quitar saltos de línea internos

    console.log("🔑 Clave privada (parcial):", pemKey.substring(0, 50) + "...");

    // 📌 Convertir clave privada de Base64 a binario
    let keyBuffer;
    try {
      keyBuffer = Uint8Array.from(atob(pemKey), (c) => c.charCodeAt(0));
    } catch (error) {
      console.error("❌ Error al decodificar la clave privada en Base64:", error);
      throw new Error("No se pudo decodificar la clave privada correctamente.");
    }

    // 📌 Importar la clave privada como CryptoKey
    let cryptoKey;
    try {
      cryptoKey = await crypto.subtle.importKey(
        "pkcs8",
        keyBuffer.buffer,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"]
      );
    } catch (importError) {
      console.error("❌ Error importando clave privada:", importError);
      throw new Error("No se pudo importar la clave privada. Verifica el formato.");
    }

    console.log("✅ Clave privada importada correctamente.");

    // 📌 Firmar JWT con la clave privada
    let signature;
    try {
      signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(data));
    } catch (signError) {
      console.error("❌ Error al firmar el JWT:", signError);
      throw new Error("No se pudo firmar el JWT.");
    }

    const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)));
    const jwt = `${data}.${encodedSignature}`;

    // 📌 Obtener el Token de Acceso desde Google OAuth
    console.log("📡 Enviando solicitud a Google OAuth...");
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    const result = await response.json();

    // 🔍 Nuevo Log para Depuración
    console.log("🔍 Respuesta completa de Google OAuth:", result);

    if (!result.access_token) {
      throw new Error(`❌ No se pudo obtener el token OAuth. Respuesta: ${JSON.stringify(result)}`);
    }

    return result.access_token;
  } catch (error) {
    console.error("❌ Error al generar token OAuth:", error);
    throw new Error("No se pudo generar el token OAuth.");
  }
}
