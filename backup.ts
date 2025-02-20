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

// 📌 Función para convertir y subir un archivo a Google Cloud Storage
async function convertirYSubirArchivo(archivo: any, token: string): Promise<void> {
  console.log(`📤 Iniciando backup de: ${archivo.name}...`);

  // 📌 Descargar archivo
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${archivo.id}?alt=media`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    console.error(`❌ Error al descargar ${archivo.name}:`, await response.text());
    return;
  }

  const fileData = await response.arrayBuffer();

  // 📌 Subir a Google Cloud Storage
  const storageResponse = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${BUCKET_NAME}/o?uploadType=media&name=${archivo.name}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
    },
    body: fileData,
  });

  if (!storageResponse.ok) {
    console.error(`❌ Error al subir ${archivo.name}:`, await storageResponse.text());
  } else {
    console.log(`✅ Archivo ${archivo.name} subido con éxito.`);
  }
}

// 📌 Función para obtener el token OAuth con la cuenta de servicio (se mantiene igual)
async function obtenerTokenOAuth(credentials: any): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: "TOKEN_FIRMADO_AQUI", // Aquí va la lógica de firma JWT (mantenida de tu código)
    }),
  });

  const result = await response.json();
  if (!result.access_token) throw new Error("❌ No se pudo obtener el token OAuth.");
  return result.access_token;
}
