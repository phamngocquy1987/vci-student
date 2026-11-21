// Generated from supabase/functions/vci-api. Paste this entire file into the Supabase Edge Function editor as index.ts.
// This source contains no secret keys. Authentication and role checks remain enabled in the handler.

// supabase/functions/vci-api/index.ts
import { createClient } from "npm:@supabase/supabase-js@2.119.2";

// supabase/functions/vci-api/handler.ts
var identifier = /^[A-Za-z0-9_.-]{1,100}$/;
function loginEmail(username) {
  if (!identifier.test(username)) throw new Error("Mã đăng nhập chỉ gồm chữ, số, dấu chấm, gạch dưới hoặc gạch ngang.");
  return `${username.toLowerCase()}@login.vci.edu.vn`;
}
function password(value) {
  if (typeof value !== "string" || value.length < 10 || value.length > 200) throw new Error("Mật khẩu phải từ 10 đến 200 ký tự.");
  return value;
}
function createHandler(factory, env) {
  return async function handler(req) {
    const origin = req.headers.get("origin");
    const allowed = (env("ALLOWED_ORIGINS") || "").split(",").map((x) => x.trim()).filter(Boolean);
    const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Vary": "Origin" };
    const respond = (data, status2 = 200) => new Response(JSON.stringify(data), { status: status2, headers });
    if (origin && !allowed.includes(origin)) return respond({ detail: "Địa chỉ truy cập chưa được cho phép." }, 403);
    if (origin) headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "authorization, apikey, content-type, x-client-info";
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method !== "POST") return respond({ detail: "Chỉ nhận POST." }, 405);
    let status = 400;
    try {
      if (Number(req.headers.get("content-length") || 0) > 1e4) return respond({ detail: "Yêu cầu quá lớn." }, 413);
      const token = req.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
      if (!token) return respond({ detail: "Vui lòng đăng nhập." }, 401);
      const url = env("SUPABASE_URL"), anon = env("SUPABASE_ANON_KEY"), serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
      if (!url || !anon || !serviceKey) return respond({ detail: "Chưa cấu hình dịch vụ tài khoản." }, 503);
      const userClient = factory(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
      const { data: auth, error: authError } = await userClient.auth.getUser(token);
      if (authError || !auth?.user) return respond({ detail: "Phiên đăng nhập hết hạn." }, 401);
      const { data: identity, error: identityError } = await userClient.rpc("vci_read", { route: "/me", params: {} });
      if (identityError || !identity?.user) return respond({ detail: "Tài khoản chưa được cấp quyền hoặc cần đăng nhập lại." }, 401);
      if (identity.user.role !== "admin") return respond({ detail: "Chỉ quản trị được quản lý tài khoản." }, 403);
      const text = await req.text();
      if (text.length > 1e4) return respond({ detail: "Yêu cầu quá lớn." }, 413);
      const { route, body = {} } = JSON.parse(text);
      const service = factory(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const rpc = async (route2, body2 = {}, method = "POST") => {
        const result = await userClient.rpc("vci_write", { method, route: route2, body: body2 });
        if (result.error) throw new Error(result.error.message);
        return result.data;
      };
      const createStudent = async (row, initialPassword, importId, importIndex) => {
        if (typeof row.full_name !== "string" || !row.full_name.trim() || row.full_name.length > 150 || !Number.isSafeInteger(row.class_id) || row.class_id <= 0) throw new Error("Tên hoặc lớp sinh viên không hợp lệ.");
        const metadata = { ...row, role: "student", import_id: importId, import_index: importIndex };
        const vci = {};
        for (const key of ["username", "full_name", "class_id", "role", "surname", "given_name", "birth_date", "birth_place", "gender", "ethnicity", "national_id", "note", "import_id", "import_index"]) if (metadata[key] !== void 0) vci[key] = metadata[key];
        const result = await service.auth.admin.createUser({ email: loginEmail(row.username), password: password(initialPassword), email_confirm: true, app_metadata: { vci } });
        if (result.error) throw new Error("Không tạo được tài khoản. Kiểm tra tài khoản/CCCD trùng, lớp nhận và quy tắc mật khẩu trong Supabase. Các tài khoản đã tạo được giữ lại; có thể bấm tạo lại để tiếp tục.");
        return result.data.user;
      };
      if (route === "/students") {
        const user = await createStudent(body, body.password);
        await service.from("vci_audit").insert({ actor: identity.user.username, action: "create_student", detail: body.username });
        return respond({ ok: true, auth_id: user.id });
      }
      const match = typeof route === "string" && route.match(/^\/student-imports\/([0-9a-f-]+)\/confirm$/);
      if (match) {
        const batchId = match[1];
        let batch = await rpc(`/student-imports/${batchId}/status`);
        if (batch.errors.length || !batch.count) throw new Error("Danh sách có lỗi. Hãy kiểm tra và nhập lại.");
        if (batch.done) return respond({ ok: true, count: batch.count, created: batch.created, done: true });
        const completed = new Set(batch.created_indices);
        const pending = batch.rows.map((row, index) => ({ row, index })).filter((x) => !completed.has(x.index)).slice(0, 5);
        for (const { row, index } of pending) await createStudent(row, row.source_format === "school" ? row.national_id : body.password, batchId, index);
        batch = await rpc(`/student-imports/${batchId}/status`);
        return respond({ ok: true, count: batch.count, created: batch.created, done: batch.done });
      }
      const reset = typeof route === "string" && route.match(/^\/students\/(\d+)\/password$/);
      if (reset) {
        const { data: account, error } = await service.from("vci_accounts").select("auth_id,username").eq("id", Number(reset[1])).eq("role", "student").single();
        if (error || !account) return respond({ detail: "Không tìm thấy sinh viên." }, 404);
        const result = await service.auth.admin.updateUserById(account.auth_id, { password: password(body.password) });
        if (result.error) throw new Error("Không đổi được mật khẩu.");
        await service.from("vci_audit").insert({ actor: identity.user.username, action: "reset_password", detail: account.username });
        return respond({ ok: true });
      }
      return respond({ detail: "Không tìm thấy chức năng." }, 404);
    } catch (error) {
      return respond({ detail: error instanceof Error ? error.message : "Yêu cầu không thành công." }, status);
    }
  };
}

// supabase/functions/vci-api/index.ts
Deno.serve(createHandler(createClient, (key) => Deno.env.get(key)));
