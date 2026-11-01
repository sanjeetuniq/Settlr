import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { MAX_AVATAR_BYTES, validateAvatar } from "@/lib/avatar-validation";
import { createClient } from "@/lib/supabase/server";

const maxRequestBytes = MAX_AVATAR_BYTES + 64 * 1024;

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function getSignedInClient() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return { supabase, user: null };
  return { supabase, user };
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return errorResponse("Cross-origin profile-photo requests are not allowed.", 403);
  }

  const { supabase, user } = await getSignedInClient();
  if (!user) return errorResponse("Sign in to update your profile photo.", 401);

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    return errorResponse("Submit the photo as a form.", 400);
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) {
    return errorResponse("Choose an image up to 2 MB.", 413);
  }

  let formData: FormData;
  try {
    const reader = request.body?.getReader();
    if (!reader) return errorResponse("The photo request has no form body.", 400);

    const chunks: ArrayBuffer[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxRequestBytes) {
        await reader.cancel();
        return errorResponse("Choose an image up to 2 MB.", 413);
      }
      const chunk = new Uint8Array(value.byteLength);
      chunk.set(value);
      chunks.push(chunk.buffer);
    }

    const parsedRequest = new Request(request.url, {
      method: "POST",
      headers: { "content-type": contentType },
      body: new Blob(chunks),
    });
    formData = await parsedRequest.formData();
  } catch {
    return errorResponse("The photo form could not be read.", 400);
  }

  const submittedFile = formData.get("photo");
  if (!(submittedFile instanceof File) || submittedFile.size === 0) {
    return errorResponse("Choose a profile photo to upload.", 400);
  }
  if (submittedFile.size > MAX_AVATAR_BYTES) {
    return errorResponse("Choose an image up to 2 MB.", 413);
  }

  const bytes = new Uint8Array(await submittedFile.arrayBuffer());
  const validation = validateAvatar(bytes, submittedFile.type);
  if (!validation.valid) return errorResponse(validation.message, 415);

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("avatar_path")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) {
    console.error("Profile photo metadata lookup failed:", profileError.message);
    return errorResponse("Your profile could not be loaded.", 500);
  }
  if (!profile) return errorResponse("Create your profile before adding a photo.", 409);

  const oldPath = profile.avatar_path;
  const newPath = `${user.id}/${randomUUID()}.${validation.extension}`;
  const { error: uploadError } = await supabase.storage
    .from("profile-avatars")
    .upload(newPath, bytes, {
      contentType: validation.contentType,
      upsert: false,
    });
  if (uploadError) {
    console.error("Profile photo upload failed:", uploadError.message);
    return errorResponse(
      ["Bucket not found", "new row violates row-level security policy"].some((message) =>
        uploadError.message.includes(message),
      )
        ? "Profile photo storage is not configured. Apply the profile-photo migration and try again."
        : "The profile photo could not be uploaded. Try again.",
      503,
    );
  }

  const { data: updatedProfile, error: updateError } = await supabase
    .from("profiles")
    .update({ avatar_path: newPath })
    .eq("id", user.id)
    .select("id")
    .maybeSingle();
  if (updateError || !updatedProfile) {
    const { error: cleanupError } = await supabase.storage
      .from("profile-avatars")
      .remove([newPath]);
    if (cleanupError) {
      console.error("Unused profile photo cleanup failed:", cleanupError.message);
    }
    if (updateError) {
      console.error("Profile photo metadata update failed:", updateError.message);
    }
    return errorResponse("The profile photo could not be saved.", 500);
  }

  if (oldPath) {
    const { error: cleanupError } = await supabase.storage
      .from("profile-avatars")
      .remove([oldPath]);
    if (cleanupError) {
      console.error("Old profile photo cleanup failed:", cleanupError.message);
    }
  }

  revalidatePath("/");
  revalidatePath("/balances");
  revalidatePath("/settings");
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return errorResponse("Cross-origin profile-photo requests are not allowed.", 403);
  }

  const { supabase, user } = await getSignedInClient();
  if (!user) return errorResponse("Sign in to update your profile photo.", 401);

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("avatar_path")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) {
    console.error("Profile photo metadata lookup failed:", profileError.message);
    return errorResponse("Your profile could not be loaded.", 500);
  }
  if (!profile) return errorResponse("Your profile could not be loaded.", 404);
  if (!profile.avatar_path) return NextResponse.json({ success: true });

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ avatar_path: null })
    .eq("id", user.id);
  if (updateError) {
    console.error("Profile photo removal failed:", updateError.message);
    return errorResponse("The profile photo could not be removed.", 500);
  }

  const { error: removeError } = await supabase.storage
    .from("profile-avatars")
    .remove([profile.avatar_path]);
  if (removeError) {
    console.error("Removed profile photo could not be deleted from Storage:", removeError.message);
    return NextResponse.json(
      {
        error: "The profile photo was removed, but its stored file could not be deleted.",
        detached: true,
      },
      { status: 500 },
    );
  }

  revalidatePath("/");
  revalidatePath("/balances");
  revalidatePath("/settings");
  return NextResponse.json({ success: true });
}
