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
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/devstorage.full_control",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  // 📌 Firmar el JWT
  const encodeBase64 = (obj: any) => btoa(JSON.stringify(obj));
  const jwt = `${encodeBase64(header)}.${encodeBase64(payload)}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    await crypto.subtle.importKey(
      "pkcs8",
      Uint8Array.from(atob(credentials.private_key.replace(/\\n/g, "\n")), (c) => c.charCodeAt(0)).buffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    ),
    new TextEncoder().encode(jwt)
  );
  
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${jwt}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`,
    }),
  });

  const result = await tokenResponse.json();
  if (!result.access_token) throw new Error("❌ No se pudo obtener el token OAuth.");

  return result.access_token;
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

// 📌 Función para seguir accesos directos
async function obtenerHojasDesdeCarpeta(folderId: string, token: string) {
  let hojas = await listarHojasDeCalculo(folderId, token);
  for (const hoja of hojas) {
    if (hoja.mimeType === "application/vnd.google-apps.shortcut" && hoja.shortcutDetails?.targetId) {
      console.log(`🔗 Siguiendo acceso directo a: ${hoja.shortcutDetails.targetId}`);
      hojas = hojas.concat(await obtenerHojasDesdeCarpeta(hoja.shortcutDetails.targetId, token));
    }
  }
  return hojas;
}

// 📌 Función para convertir Google Sheet a XLSX
async function convertirGoogleSheetAXLSX(fileId: string, fileName: string, token: string): Promise<Uint8Array> {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`❌ Error al convertir ${fileName} a XLSX.`);
  return new Uint8Array(await response.arrayBuffer());
}

// 📌 Función para subir archivos a Google Cloud Storage
async function subirArchivoAGCS(fileName: string, fileData: Uint8Array, token: string) {
  const bucketName = "TU_BUCKET_NAME";
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
  const hojas = await obtenerHojasDesdeCarpeta(folderId, token);

  console.log(`📄 Total de hojas a respaldar: ${hojas.length}`);
  for (const hoja of hojas) {
    const xlsxData = await convertirGoogleSheetAXLSX(hoja.id, hoja.name, token);
    await subirArchivoAGCS(`${hoja.name}.xlsx`, xlsxData, token);
  }

  console.log("✅ Backup completado.");
}
