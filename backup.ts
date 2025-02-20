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
      console.log("🔑 Primera línea de la clave privada:", credentials.private_key.split("\n")[0]);

      // 📌 Obtener el token OAuth
      const token = await obtenerTokenOAuth(credentials);
      console.log("🔑 Token OAuth generado correctamente.");

      // 📌 ID de la carpeta de Google Drive a respaldar (modificar según sea necesario)
      const folderId = "1LT7ddkv2GomrY7JfymBwK6YZJXtlKufz";

      // 📌 Realizar el backup
      await realizarBackup(folderId, token);

      return new Response(
        JSON.stringify({ message: "✅ Backup completado exitosamente." }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (error) {
      console.error("❌ Error en el backup:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  return new Response("⛔ Método no permitido", { status: 405 });
});

// 📌 Función para obtener el token OAuth
async function obtenerTokenOAuth(credentials: any): Promise<string> {
  try {
    console.log("🛠️ Generando JWT...");

    const header = {
      alg: "RS256",
      typ: "JWT",
    };

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: credentials.client_email,
      scope: "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/devstorage.full_control",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    };

    // 📌 Convertir a Base64 correctamente
    const encodeBase64 = (obj: any) => btoa(JSON.stringify(obj));
    const jwtUnsigned = `${encodeBase64(header)}.${encodeBase64(payload)}`;

    // 📌 Corregir la conversión de la clave privada
    console.log("🔏 Procesando la clave privada...");
    const pemKey = credentials.private_key
      .replace(/\\n/g, "\n") 
      .replace("-----BEGIN PRIVATE KEY-----\n", "")
      .replace("\n-----END PRIVATE KEY-----", "")
      .replace(/\n/g, "");

    console.log("🔑 Clave privada (parcial):", pemKey.substring(0, 50) + "...");

    // 📌 Convertir clave privada de Base64 a binario
    let keyBuffer;
    try {
      keyBuffer = Uint8Array.from(atob(pemKey), (c) => c.charCodeAt(0));
    } catch (error) {
      console.error("❌ Error al decodificar la clave privada:", error);
      throw new Error("No se pudo decodificar la clave privada correctamente.");
    }

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

    // 📌 Firmar el JWT con la clave privada
    let signature;
    try {
      signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(jwtUnsigned));
    } catch (signError) {
      console.error("❌ Error al firmar el JWT:", signError);
      throw new Error("No se pudo firmar el JWT.");
    }

    const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)));
    const jwt = `${jwtUnsigned}.${encodedSignature}`;

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

// 📌 Función para listar solo archivos Google Sheets en una carpeta
async function listarHojasDeCalculo(folderId: string, token: string) {
  const url = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents&fields=files(id,name,mimeType,shortcutDetails)`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const data = await response.json();
  return data.files.filter((file: any) => file.mimeType === "application/vnd.google-apps.spreadsheet");
}

// 📌 Función para convertir Google Sheet a XLSX
async function convertirGoogleSheetAXLSX(fileId: string, token: string): Promise<Uint8Array> {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`❌ Error al convertir a XLSX.`);
  return new Uint8Array(await response.arrayBuffer());
}

// 📌 Función para subir archivos a Google Cloud Storage
async function subirArchivoAGCS(fileName: string, fileData: Uint8Array, token: string) {
  const bucketName = "cloud-ai-platform-f42b7b51-2a5b-4719-af77-65cf76b7dd86";
  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${bucketName}/o?uploadType=media&name=${fileName}`;

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    body: fileData,
  });

  if (!response.ok) throw new Error(`❌ Error al subir ${fileName} a GCS.`);
  console.log(`☁️ Archivo subido: ${fileName}`);
}

// 📌 Función principal de backup
async function realizarBackup(folderId: string, token: string) {
  console.log("📂 Buscando Google Sheets...");
  const hojas = await listarHojasDeCalculo(folderId, token);

  console.log(`📄 Total de hojas a respaldar: ${hojas.length}`);
  for (const hoja of hojas) {
    const xlsxData = await convertirGoogleSheetAXLSX(hoja.id, token);
    await subirArchivoAGCS(`${hoja.name}.xlsx`, xlsxData, token);
  }

  console.log("✅ Backup completado.");
}
