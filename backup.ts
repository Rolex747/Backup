// 📌 Importar el módulo de servidor HTTP de Deno
import { serve } from "https://deno.land/std@0.181.0/http/server.ts";

// 📌 Iniciar el servidor en Deno Deploy
serve(async (req) => {
  if (req.method === "POST") {
    console.log("🚀 Iniciando backup...");

    // **Responder inmediatamente para evitar timeout**
    const response = new Response(
      JSON.stringify({ message: "✅ Backup iniciado en segundo plano." }),
      { status: 202, headers: { "Content-Type": "application/json" } }
    );

    // **Ejecutar el backup en segundo plano sin bloquear la respuesta HTTP**
    (async () => {
      try {
        // 📌 Leer credenciales desde la variable de entorno
        const credentials = JSON.parse(Deno.env.get("GOOGLE_CLOUD_CREDENTIALS") || "{}");

        if (!credentials.client_email || !credentials.private_key) {
          throw new Error("❌ Credenciales de Google Cloud no encontradas.");
        }

        console.log("✅ Credenciales cargadas correctamente:", credentials.client_email);

        // 📌 Obtener el token OAuth
        const token = await obtenerTokenOAuth(credentials);
        console.log("🔑 Token OAuth generado correctamente.");

        // 📌 ID de la carpeta de Google Drive a respaldar
        const folderId = "1LT7ddkv2GomrY7JfymBwK6YZJXtlKufz";

        // 📌 Realizar el backup en segundo plano
        await realizarBackup(folderId, token);

      } catch (error) {
        console.error("❌ Error en el backup:", error);
      }
    })();

    return response; // **Retorna inmediatamente sin esperar que termine el backup**
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

    console.log("📝 JWT sin firmar:", jwtUnsigned);

    // 📌 Procesar la clave privada correctamente
    console.log("🔏 Procesando la clave privada...");
    const pemKey = credentials.private_key
      .replace(/\\n/g, "\n")
      .replace("-----BEGIN PRIVATE KEY-----\n", "")
      .replace("\n-----END PRIVATE KEY-----", "")
      .replace(/\n/g, "");

    console.log("🔑 Clave privada (parcial):", pemKey.substring(0, 50) + "...");

    // 📌 Convertir clave privada a binario
    let keyBuffer;
    try {
      keyBuffer = Uint8Array.from(atob(pemKey), (c) => c.charCodeAt(0));
      console.log("🔓 Clave privada decodificada correctamente.");
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
      console.log("✅ Clave privada importada correctamente.");
    } catch (importError) {
      console.error("❌ Error importando clave privada:", importError);
      throw new Error("No se pudo importar la clave privada. Verifica el formato.");
    }

    // 📌 Firmar el JWT con la clave privada
    let signature;
    try {
      signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(jwtUnsigned));
      console.log("✅ JWT firmado correctamente.");
    } catch (signError) {
      console.error("❌ Error al firmar el JWT:", signError);
      throw new Error("No se pudo firmar el JWT.");
    }

    const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)));
    const jwt = `${jwtUnsigned}.${encodedSignature}`;

    console.log("🔑 JWT completo:", jwt);

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

// 📌 Función para obtener archivos de Google Sheets, incluyendo Google Apps Scripts ligados
async function listarHojasDeCalculo(folderId: string, token: string) {
  console.log(`📂 Buscando archivos en la carpeta ${folderId}...`);

  const url = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents&fields=files(id,name,mimeType,shortcutDetails)`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });

  if (!response.ok) {
    console.error(`❌ Error al obtener archivos de la carpeta:`, await response.text());
    throw new Error("No se pudo obtener la lista de archivos de Google Drive.");
  }

  let archivos = (await response.json()).files || [];
  let hojas = [];

  for (const file of archivos) {
    if (file.mimeType === "application/vnd.google-apps.spreadsheet") {
      // 📄 Es un Google Sheet, lo añadimos a la lista
      console.log(`📄 Detectado Google Sheet: ${file.name}`);

      // 📌 Revisar si hay un Apps Script ligado a esta hoja
      const scriptId = await obtenerScriptLigado(file.id, token);
      hojas.push({ ...file, scriptId });
    } else if (file.mimeType === "application/vnd.google-apps.folder") {
      // 📂 Es una subcarpeta, exploramos su contenido
      console.log(`📂 Explorando subcarpeta: ${file.name}`);
      const hojasEnSubcarpeta = await listarHojasDeCalculo(file.id, token);
      hojas = hojas.concat(hojasEnSubcarpeta);
    } else if (file.mimeType === "application/vnd.google-apps.shortcut" && file.shortcutDetails?.targetId) {
      // 🔗 Es un shortcut, revisamos si es un Google Sheet o una carpeta
      const targetId = file.shortcutDetails.targetId;
      console.log(`🔗 Detectado shortcut: ${file.name} -> ${targetId}`);

      try {
        const targetUrl = `https://www.googleapis.com/drive/v3/files/${targetId}?fields=id,name,mimeType`;
        const targetResponse = await fetch(targetUrl, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        });

        const targetData = await targetResponse.json();

        if (!targetResponse.ok) {
          console.warn(`⚠️ No se pudo acceder al destino del shortcut ${file.name}.`, targetData);
          continue;
        }

        if (targetData.mimeType === "application/vnd.google-apps.spreadsheet") {
          // 📄 El shortcut apunta a un Google Sheet, revisar si tiene Apps Script
          const scriptId = await obtenerScriptLigado(targetData.id, token);
          hojas.push({ ...targetData, scriptId });
        } else if (targetData.mimeType === "application/vnd.google-apps.folder") {
          // 📂 El shortcut apunta a una carpeta, exploramos su contenido
          console.log(`📂 Shortcut apunta a una carpeta, listando su contenido...`);
          const hojasEnShortcut = await listarHojasDeCalculo(targetId, token);
          hojas = hojas.concat(hojasEnShortcut);
        }
      } catch (error) {
        console.error(`❌ Error al procesar el shortcut ${file.name}:`, error);
      }
    }
  }

  console.log(`📄 Total de hojas detectadas en ${folderId}: ${hojas.length}`);
  return hojas;
}

// 📌 Función para verificar si un Google Sheet tiene un Apps Script ligado
async function obtenerScriptLigado(sheetId: string, token: string): Promise<string | null> {
  console.log(`🔍 Buscando Apps Script ligado a la hoja ${sheetId}...`);

  const url = `https://script.googleapis.com/v1/projects`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });

  const data = await response.json();
  console.log(`📡 Respuesta de Google Apps Script API:`, data);

  if (data.projects) {
    for (const project of data.projects) {
      if (project.scriptId && project.parentId === sheetId) {
        console.log(`✅ Apps Script detectado: ${project.scriptId}`);
        return project.scriptId;
      }
    }
  }

  console.log(`⚠️ No se encontró Apps Script ligado a ${sheetId}`);
  return null;
}

// 📌 Función para descargar el código del Apps Script
async function descargarAppsScript(scriptId: string, token: string): Promise<Uint8Array> {
  console.log(`📥 Descargando código de Apps Script ${scriptId}...`);

  const url = `https://script.googleapis.com/v1/projects/${scriptId}/content`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.google-apps.script+json" },
  });

  const responseText = await response.text();
  console.log(`📡 Respuesta de Google Apps Script API:`, responseText);

  if (!response.ok) {
    console.error(`❌ Error al descargar el Apps Script ${scriptId}.`, responseText);
    throw new Error(`No se pudo descargar el Apps Script ${scriptId}`);
  }

  return new TextEncoder().encode(responseText); // Convertir a Uint8Array
}

// 📌 Función principal de backup (incluye Apps Scripts)
async function realizarBackup(folderId: string, token: string) {
  console.log("📂 Buscando Google Sheets...");
  const hojas = await listarHojasDeCalculo(folderId, token);

  console.log(`📄 Total de hojas a respaldar: ${hojas.length}`);
  for (const hoja of hojas) {
    // 📌 Convertir Google Sheet a XLSX
    const xlsxData = await convertirGoogleSheetAXLSX(hoja.id, token);
    await subirArchivoAGCS(`${hoja.name}.xlsx`, xlsxData, token);

    // 📌 Verificar si hay un Apps Script vinculado y hacer backup
    const scriptId = await obtenerScriptLigado(hoja.id, token);
    if (scriptId) {
      console.log(`📥 Descargando Apps Script vinculado a ${hoja.name}...`);
      const scriptData = await descargarAppsScript(scriptId, token);
      await subirArchivoAGCS(`${hoja.name}.gs.zip`, scriptData, token);
    }
  }

  console.log("✅ Backup completado.");
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

// 📌 Función para subir archivos a Google Cloud Storage en una carpeta con fecha
async function subirArchivoAGCS(fileName: string, fileData: Uint8Array, token: string) {
  // 📌 Obtener la fecha actual en formato YYYY-MM-DD
  const fecha = new Date().toISOString().split("T")[0]; // Ejemplo: "2025-02-20"

  // 📌 Crear la ruta dentro del bucket
  const folderPath = `backups/${fecha}/${fileName}`; // Ejemplo: backups/2025-02-20/nombre.xlsx

  console.log(`☁️ Subiendo archivo a GCS: ${folderPath}`);

  const bucketName = "cloud-ai-platform-f42b7b51-2a5b-4719-af77-65cf76b7dd86";
  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${bucketName}/o?uploadType=media&name=${folderPath}`;

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    body: fileData,
  });

  if (!response.ok) {
    console.error(`❌ Error al subir ${fileName} a GCS.`, await response.text());
    throw new Error(`No se pudo subir ${fileName} a GCS.`);
  }

  console.log(`✅ Archivo subido correctamente: ${folderPath}`);
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
