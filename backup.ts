// 📌 Importar módulos necesarios
import { serve } from "https://deno.land/std@0.181.0/http/server.ts";

// 📌 Configurar constantes
const GOOGLE_DRIVE_FOLDER_ID = "ID_DE_LA_CARPETA_DRIVE"; // 📂 ID de la carpeta de Drive a respaldar
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

// 📌 Función para obtener archivos Google Sheets en una carpeta de Google Drive
async function obtenerArchivosEnCarpeta(folderId: string, token: string) {
  console.log("📡 Obteniendo archivos en la carpeta de Google Drive...");

  const url = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+(mimeType='application/vnd.google-apps.spreadsheet' or mimeType='application/vnd.google-apps.shortcut')&fields=files(id,name,mimeType,shortcutDetails)`;

  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  const result = await response.json();

  if (result.error) {
    console.error("❌ Error al obtener archivos de Drive:", result.error);
    throw new Error(result.error.message);
  }

  let archivos = result.files || [];

  // 📌 Seguir shortcuts y obtener archivos de carpetas reales
  const archivosReales = [];
  for (const archivo of archivos) {
    if (archivo.mimeType === "application/vnd.google-apps.shortcut" && archivo.shortcutDetails?.targetId) {
      console.log(`🔄 Siguiendo shortcut: ${archivo.name} -> ${archivo.shortcutDetails.targetId}`);
      const archivosEnShortcut = await obtenerArchivosEnCarpeta(archivo.shortcutDetails.targetId, token);
      archivosReales.push(...archivosEnShortcut);
    } else {
      archivosReales.push(archivo);
    }
  }

  return archivosReales;
}

// 📌 Función para convertir Google Sheets a XLSX y subir a Google Cloud Storage
async function convertirYSubirArchivo(archivo: any, token: string) {
  console.log(`📄 Convirtiendo archivo: ${archivo.name} (ID: ${archivo.id})`);

  const exportUrl = `https://www.googleapis.com/drive/v3/files/${archivo.id}/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`;

  const response = await fetch(exportUrl, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    console.error(`❌ Error al convertir ${archivo.name}:`, await response.text());
    return;
  }

  const blob = await response.arrayBuffer();
  const fileName = `${archivo.name}.xlsx`;

  await subirACloudStorage(blob, fileName, token);
}

// 📌 Función para subir archivo a Google Cloud Storage
async function subirACloudStorage(blob: ArrayBuffer, fileName: string, token: string) {
  console.log(`📤 Subiendo ${fileName} a Google Cloud Storage...`);

  const url = `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET_NAME}/o?uploadType=media&name=${fileName}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    body: blob,
  });

  if (!response.ok) {
    console.error(`❌ Error al subir ${fileName}:`, await response.text());
    return;
  }

  console.log(`✅ ${fileName} subido correctamente.`);
}

// 📌 Función para obtener el token OAuth
async function obtenerTokenOAuth(credentials: any): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: await crearJWT(credentials),
    }),
  });

  const result = await response.json();
  if (!result.access_token) throw new Error("❌ No se pudo obtener el token OAuth.");
  return result.access_token;
}

// 📌 Función para crear JWT y autenticar con Google
async function crearJWT(credentials: any): Promise<string> {
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
  const signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", credentials.private_key, new TextEncoder().encode(data)))));
  return `${data}.${signature}`;
}
