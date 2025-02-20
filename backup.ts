// 📌 Importar módulos necesarios
import { serve } from "https://deno.land/std@0.181.0/http/server.ts";

// 📌 Configurar constantes
const GOOGLE_DRIVE_FOLDER_ID = "1LT7ddkv2GomrY7JfymBwK6YZJXtlKufz"; // 📂 ID de la carpeta de Drive a respaldar
const BUCKET_NAME = "backups-drive-feasy"; // 📦 Nombre del bucket de Google Cloud Storage

// 📌 Iniciar el servidor en Deno Deploy
serve(async (req) => {
  if (req.method === "POST") {
    console.log("🚀 Iniciando backup de Google Drive...");

    try {
      // 📌 Leer credenciales desde la variable de entorno en Deno Deploy
      const credentials = JSON.parse(Deno.env.get("GOOGLE_CLOUD_CREDENTIALS") || "{}");

      if (!credentials.client_email || !credentials.private_key) {
        throw new Error("❌ Credenciales de Google Cloud no encontradas.");
      }

      console.log("✅ Credenciales cargadas correctamente:", credentials.client_email);
      console.log("🔑 Primera línea de la clave privada:", credentials.private_key.split("\n")[0]);

      // 📌 Obtener el token OAuth
      const token = await obtenerTokenOAuth(credentials);
      console.log("🔑 Token OAuth generado correctamente.");

      // 📌 Obtener lista de accesos directos en la carpeta de Google Drive
      const accesosDirectos = await obtenerAccesosDirectos(GOOGLE_DRIVE_FOLDER_ID, token);

      if (!accesosDirectos || accesosDirectos.length === 0) {
        throw new Error("❌ No se encontraron accesos directos a carpetas en la carpeta principal.");
      }

      console.log(`📂 Se encontraron ${accesosDirectos.length} accesos directos a carpetas.`);

      // 📌 Recorrer cada acceso directo y obtener los archivos dentro de la carpeta destino
      for (const acceso of accesosDirectos) {
        console.log(`📁 Procesando carpeta destino: ${acceso.nombre}`);

        const archivos = await obtenerArchivosEnCarpeta(acceso.targetId, token);
        if (!archivos || archivos.length === 0) {
          console.log(`⚠️ No hay archivos en la carpeta ${acceso.nombre}.`);
          continue;
        }

        console.log(`📄 Se encontraron ${archivos.length} archivos en la carpeta ${acceso.nombre}. Iniciando backup...`);

        // 📌 Convertir y subir cada archivo
        for (const archivo of archivos) {
          await convertirYSubirArchivo(archivo, token);
        }
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

// 📌 Función para obtener los accesos directos en una carpeta
async function obtenerAccesosDirectos(folderId: string, token: string): Promise<{ nombre: string; targetId: string }[]> {
  console.log(`📡 Buscando accesos directos en la carpeta ${folderId}...`);

  const response = await fetch(`https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+mimeType='application/vnd.google-apps.shortcut'&fields=files(id,name,shortcutDetails)`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await response.json();
  if (!data.files || data.files.length === 0) return [];

  return data.files
    .filter((file: any) => file.shortcutDetails && file.shortcutDetails.targetId)
    .map((file: any) => ({
      nombre: file.name,
      targetId: file.shortcutDetails.targetId,
    }));
}

// 📌 Función para obtener archivos en una carpeta
async function obtenerArchivosEnCarpeta(folderId: string, token: string): Promise<any[]> {
  console.log(`📡 Buscando archivos en la carpeta ${folderId}...`);

  const response = await fetch(`https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents&fields=files(id,name,mimeType)`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await response.json();
  return data.files || [];
}

// 📌 Función para obtener el token OAuth con la cuenta de servicio
async function obtenerTokenOAuth(credentials: any): Promise<string> {
  try {
    console.log("🛠️ Generando JWT...");

    const header = { alg: "RS256", typ: "JWT" };

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: credentials.client_email,
      scope: "https://www.googleapis.com/auth/devstorage.full_control",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    };

    const encodeBase64 = (obj: any) => btoa(JSON.stringify(obj));
    const encodedHeader = encodeBase64(header);
    const encodedPayload = encodeBase64(payload);

    const data = `${encodedHeader}.${encodedPayload}`;

    console.log("🔏 Procesando la clave privada...");
    
    // 📌 Limpiar la clave privada correctamente
    const pemKey = credentials.private_key.replace(/\\n/g, "\n").trim();
    
    console.log("🔑 Primera línea de private_key (limpia):", pemKey.split("\n")[0]);

    // 📌 Convertir clave privada a formato binario
    let keyBuffer;
    try {
      keyBuffer = Uint8Array.from(atob(pemKey), (c) => c.charCodeAt(0));
    } catch (error) {
      console.error("❌ Error al decodificar la clave privada:", error);
      throw new Error("Formato incorrecto de private_key. Asegúrate de que está en formato válido.");
    }

    let cryptoKey = await crypto.subtle.importKey(
      "pkcs8",
      keyBuffer.buffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );

    console.log("✅ Clave privada importada correctamente.");

    let signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(data));

    const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)));
    const jwt = `${data}.${encodedSignature}`;

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
    console.log("🔍 Respuesta OAuth:", result);

    if (!result.access_token) {
      throw new Error(`❌ No se pudo obtener el token OAuth. Respuesta: ${JSON.stringify(result)}`);
    }

    return result.access_token;
  } catch (error) {
    console.error("❌ Error al generar token OAuth:", error);
    throw new Error("No se pudo generar el token OAuth.");
  }
}
