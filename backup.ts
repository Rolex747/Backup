import { serve } from "https://deno.land/std/http/server.ts";

// 📌 Verificar si el token OAuth recibido es válido
async function verificarTokenOAuth(token: string): Promise<boolean> {
  const respuesta = await fetch("https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=" + token);
  const data = await respuesta.json();
  
  if (data.error) {
    console.error("❌ Token inválido:", data.error);
    return false;
  }

  console.log("✅ Token válido para:", data.email);
  return true;
}

// 📌 Acceder a Google Cloud Storage y listar archivos en el bucket
async function listarArchivosEnBucket(token: string) {
  const bucketName = "backups-drive-feasy"; // Nombre de tu bucket en Google Cloud
  
  const respuesta = await fetch(`https://www.googleapis.com/storage/v1/b/${bucketName}/o`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await respuesta.json();
  console.log("📂 Archivos en el bucket:", data);
}

// 📌 Servidor HTTP en Deno
serve(async (req) => {
  if (req.method === "POST") {
    const body = await req.json();
    const token = body.token;

    if (!token) {
      return new Response("❌ No se recibió un token", { status: 401 });
    }

    console.log("🔑 Token recibido:", token);

    const tokenValido = await verificarTokenOAuth(token);
    if (!tokenValido) {
      return new Response("❌ Token inválido", { status: 403 });
    }

    await listarArchivosEnBucket(token);

    return new Response("✅ Token válido, acceso al bucket permitido", { status: 200 });
  }

  return new Response("❌ Método no permitido", { status: 405 });
});
