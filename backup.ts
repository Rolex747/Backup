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
