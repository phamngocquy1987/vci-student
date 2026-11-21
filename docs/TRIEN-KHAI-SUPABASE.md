# Đưa VCI Student lên iPhone và máy tính bằng GitHub + Supabase

Bản này dùng GitHub Pages để cung cấp giao diện và Supabase để quản lý đăng nhập, lớp, hồ sơ, lịch và thông báo. Không cần quyền quản trị CloudX. Sinh viên và cán bộ dùng cùng địa chỉ, hệ thống hiển thị chức năng theo tài khoản. App cài qua website là PWA, không cần App Store.

**Hiện trạng:** đã chuẩn bị mã nguồn và kiểm tra tại máy. Chưa có dự án Supabase, kho GitHub hay thay đổi DNS được tạo tự động. Chưa đưa dữ liệu sinh viên thật lên Internet. Bản Python/SQLite tại `127.0.0.1:8765` vẫn là bản riêng để đối chiếu, không tự đồng bộ lên đám mây.

## 1. Tạo dự án Supabase miễn phí

1. Mở [Supabase](https://supabase.com/dashboard), đăng ký hoặc đăng nhập.
2. Tạo tổ chức và **New project**, tên gợi ý `VCI Student`. Chọn Free để thử nghiệm. Lưu mật khẩu cơ sở dữ liệu ở nơi riêng của nhà trường.
3. Chờ dự án sẵn sàng. Trong **Connect** hoặc **Settings → API Keys**, lấy:
   - Project URL: dạng `https://xxxxxxxx.supabase.co`.
   - Publishable key: bắt đầu bằng `sb_publishable_`; có thể dùng `anon` key cũ nếu dự án cung cấp.
4. Đây là hai thông tin công khai được dùng cho giao diện. **Không đưa Secret key, service_role key, mật khẩu cơ sở dữ liệu, CCCD hoặc tệp Excel sinh viên vào GitHub.**

[Phân biệt các loại khóa Supabase](https://supabase.com/docs/guides/api/api-keys).

## 2. Tạo bảng và phân quyền

Trong dự án Supabase mới, mở **SQL Editor → New query**. Chép toàn bộ nội dung tệp:

`supabase/migrations/202611210001_vci.sql`

Bấm **Run** một lần. Tệp dành cho một dự án mới, không chạy lại trên hệ thống đã có dữ liệu. Bản SQL này tạo bảng, chỉ mục, quy tắc truy cập theo lớp và các thao tác có kiểm tra quyền.

Trong **Authentication → Sign In / Providers**, giữ đăng nhập Email/Password bật, tắt **Allow new users to sign up**. Tài khoản được quản trị cấp, không tự đăng ký công khai. Tài khoản sinh viên dùng CCCD trên giao diện; bên trong Auth dùng địa chỉ kỹ thuật `CCCD@login.vci.edu.vn`, không phải hộp thư và không gửi email tới địa chỉ đó. Cấp lại mật khẩu qua cán bộ quản trị.

Để tương thích mật khẩu CCCD ban đầu, không bật yêu cầu bắt buộc chữ hoa/chữ thường/ký tự đặc biệt cho tất cả tài khoản tại bước thử nghiệm. Giao diện vẫn yêu cầu mật khẩu do quản trị nhập dài ít nhất 10 ký tự; CCCD gồm 12 chữ số. Sinh viên có mục **Đổi mật khẩu** sau khi đăng nhập.

## 3. Triển khai chức năng tạo/cấp lại tài khoản

**Cách dùng trình duyệt, không cần dòng lệnh:** mở Edge Functions → tạo/deploy function qua Editor, đặt tên chính xác `vci-api`. Mở `deployment/vci-api.ts`, chép toàn bộ vào `index.ts` thay mã minh họa, rồi Deploy. Trong cấu hình function, tắt lớp **Verify JWT with legacy secret**; mã function vẫn tự xác thực người dùng bằng Supabase Auth và kiểm tra quyền quản trị ở cơ sở dữ liệu. Sau đó trong Edge Functions → Secrets thêm `ALLOWED_ORIGINS` với các địa chỉ gốc được phép như hướng dẫn bên dưới. Tệp một phần này được tạo bằng `node tools/build_edge.mjs`; nếu sửa nguồn function thì tạo lại tệp trước khi dán vào Dashboard.

**Cách dùng dòng lệnh:**

Máy tính cần Node.js 22 trở lên. Mở PowerShell trong thư mục `VCI-Student`, chạy:

```powershell
npx supabase login
```

Đăng nhập tài khoản Supabase của bạn trong trình duyệt. Lấy **Project Reference** trong Settings → General, thay `MA_DU_AN` ở hai lệnh sau:

```powershell
npx supabase secrets set "ALLOWED_ORIGINS=https://TEN_GITHUB.github.io,https://daotao.vci.edu.vn" --project-ref MA_DU_AN
npx supabase functions deploy vci-api --project-ref MA_DU_AN --no-verify-jwt
```

Thay `TEN_GITHUB` bằng tên tài khoản/tổ chức GitHub sẽ xuất bản trang. `ALLOWED_ORIGINS` chỉ chứa địa chỉ gốc, không có tên kho sau dấu `/`. Ví dụ trang `https://abc.github.io/vci-student/` dùng origin `https://abc.github.io`.

Khóa máy chủ `SUPABASE_SERVICE_ROLE_KEY` được Supabase cấp sẵn trong môi trường Edge Function; không chép nó vào giao diện hay cấu hình GitHub. Function tự kiểm tra phiên bằng Supabase Auth và quyền quản trị từ bảng được bảo vệ trước mỗi yêu cầu. Cờ `--no-verify-jwt` tắt lớp kiểm tra JWT cũ của gateway để function tự xác thực; không làm chức năng quản trị trở thành công khai.

[Hướng dẫn triển khai Edge Function](https://supabase.com/docs/guides/functions/deploy).

## 4. Tạo tài khoản quản trị đầu tiên

Chạy trên máy của bạn:

```powershell
python tools/create_cloud_admin.py
```

Công cụ hỏi Project URL, Secret key hoặc service_role key, tên đăng nhập, họ tên và mật khẩu mới. Khóa và mật khẩu được nhập ẩn, không ghi vào tệp. Lấy khóa quản trị trực tiếp từ bảng điều khiển Supabase, nhập vào công cụ tại máy của bạn; không gửi khóa qua chat. Công cụ chỉ tạo tài khoản mới và không ghi đè tài khoản đã có.

Sau đó đăng nhập app bằng **tên đăng nhập vừa đặt**, không cần gõ địa chỉ email kỹ thuật. Không dùng tài khoản/mật khẩu demo cũ để đăng nhập Supabase.

## 5. Xuất bản giao diện trên GitHub Pages

1. Tạo tài khoản [GitHub](https://github.com), nếu chưa có.
2. Tạo kho `vci-student`. GitHub Pages trên gói GitHub Free dùng kho **Public**. Kho chỉ chứa mã nguồn, không chứa dữ liệu sinh viên hoặc khóa bí mật. Nếu đơn vị yêu cầu mã nguồn riêng tư, chọn gói GitHub có Pages cho kho riêng tư.
3. Đưa mã nguồn trong bộ ZIP đã bàn giao vào kho, giữ cả thư mục `.github`. Không upload thư mục môi trường chạy, `data`, `private-export`, `.env` hoặc các tệp SQLite. Bộ ZIP bàn giao đã loại những mục này.
4. Trong kho, mở **Settings → Secrets and variables → Actions → Variables**, thêm hai **Repository variables**:

| Tên | Giá trị |
|---|---|
| `SUPABASE_URL` | Project URL từ bước 1 |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable key hoặc anon key, không dùng khóa quản trị |

5. Mở **Settings → Pages → Build and deployment → Source**, chọn **GitHub Actions**.
6. Mở **Actions → Publish VCI to GitHub Pages → Run workflow** trên nhánh `main`. Nếu kho mặc định dùng nhánh khác, đổi nhánh trong `.github/workflows/pages.yml` hoặc chuyển sang `main`.
7. Chờ hai bước build/deploy thành công. Link đầu tiên thường là `https://TEN_GITHUB.github.io/vci-student/`.

Workflow chỉ xuất bản thư mục `dist`: HTML, CSS, JavaScript, ảnh và cấu hình công khai. Không xuất bản backend Python, SQL, công cụ quản trị hoặc tệp dữ liệu.

Bộ mã nguồn hiện đã điền Project URL và Publishable key bạn cung cấp trong `deployment/public-config.json`. Với đúng dự án này, có thể bỏ qua bước thêm hai Repository variables ở trên; bản dựng tự đọc tệp cấu hình công khai này. Nếu đã thêm variables, giá trị trong variables được ưu tiên. Tệp này không chứa khóa quản trị, không giúp người chưa đăng nhập vượt qua phân quyền dữ liệu.

## 6. Gắn tên miền daotao.vci.edu.vn

Không cần thay đổi `daotaotuxa.vci.edu.vn` hay máy chủ Canvas đang chạy.

1. Nhờ người quản lý DNS xác minh tên miền với tài khoản/tổ chức GitHub theo [hướng dẫn xác minh](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages).
2. Trong kho → Settings → Pages, đặt **Custom domain** là `daotao.vci.edu.vn` trước khi trỏ DNS.
3. Người quản lý DNS thêm/sửa bản ghi CNAME cho **daotao**, trỏ tới **TEN_GITHUB.github.io**. Không điền tên kho, không thay bản ghi của `daotaotuxa`.
4. Khi GitHub xác nhận DNS và cấp chứng chỉ, bật **Enforce HTTPS**.
5. Thêm Repository variable `VCI_CUSTOM_DOMAIN` = `daotao.vci.edu.vn`, rồi chạy workflow lại để bản dựng cũng có CNAME đúng.
6. Trong Supabase Auth → URL Configuration, đặt Site URL = `https://daotao.vci.edu.vn`. Kiểm tra secret `ALLOWED_ORIGINS` ở bước 3 đã có địa chỉ này.

Không cần mua mục Custom Domain của Supabase chỉ để dùng tên miền cho giao diện. Giao diện dùng `daotao.vci.edu.vn`, còn kết nối dữ liệu dùng địa chỉ dự án `*.supabase.co`.

[Hướng dẫn tên miền GitHub Pages](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).

## 7. Dùng và cài ứng dụng

**Quản trị trên máy tính:** mở link, đăng nhập tài khoản cán bộ, tạo lớp theo cơ sở/năm, nhập Excel sinh viên và gắn link Drive theo học kỳ. Trong Edge/Chrome, dùng mục cài ứng dụng hoặc biểu tượng cài ở thanh địa chỉ để mở VCI trong cửa sổ riêng, ghim biểu tượng vào thanh tác vụ. Đây là PWA quản trị, không phải gói `.exe` riêng.

**Sinh viên trên iPhone:** mở link bằng Safari → Chia sẻ → Thêm vào Màn hình chính → bật Mở dưới dạng ứng dụng nếu có → Thêm. Biểu tượng trường xuất hiện trên màn hình. Không cần Mac, TestFlight hay App Store cho phương án PWA này. Có nút **Cài ứng dụng VCI** ngay trang đăng nhập để xem hướng dẫn.

App cần Internet để đăng nhập và xem dữ liệu. Service Worker chỉ lưu tài nguyên giao diện; không lưu bản sao các phản hồi hồ sơ, danh sách sinh viên hoặc API vào bộ nhớ đệm offline. Phiên đăng nhập được SDK Supabase quản lý trong trình duyệt. Không có thông báo đẩy trong bản này.

## Nhập Excel, mạng gián đoạn và dữ liệu cũ

- Giữ mẫu trường 9 cột: TT, Họ đệm, Tên, Ngày sinh, Nơi sinh, Giới tính, Dân tộc, Số CCCD, Ghi chú. Chọn lớp nhận trước khi tải mẫu hoặc nhập file.
- Mã đăng nhập và mật khẩu ban đầu lấy từ CCCD; giữ CCCD dạng văn bản để không mất số 0 đầu.
- Kiểm tra danh sách chưa tạo tài khoản. Khi xác nhận, mỗi yêu cầu tạo tối đa 5 tài khoản. Nếu lỗi mạng trong quá trình tạo, một số tài khoản có thể đã được tạo; những tài khoản này không bị xóa hay ghi đè.
- Bấm tạo lại để tiếp tục; nếu đã tải lại trang, vào Nhập sinh viên Excel → **Tiếp tục danh sách đang tạo**. Mã bản nhập được lưu trong phiên tab trình duyệt, không lưu mật khẩu chung. Bản nháp thuộc riêng cán bộ tạo và hết hạn sau 24 giờ. Không nhập lại cùng file thành bản mới khi còn bản nhập đang dở.
- Đóng hẳn phiên trình duyệt có thể mất lối tắt tiếp tục. Cán bộ có thể dùng mã bản nhập từ `vci_student_imports` của chính mình trong Supabase để xử lý; liên hệ người triển khai nếu cần khôi phục một đợt nhập chưa xong.
- Mẫu 4 cột cũ vẫn được nhận, nhưng cần mật khẩu ban đầu chung. Mẫu 9 cột được ưu tiên.
- Dữ liệu/mật khẩu SQLite cũ **không tự chuyển**. Giữ bản sao `data` trên máy trước khi chuyển. Sau khi tạo dự án, cần kiểm kê và chuyển lớp, sinh viên, lịch, thông báo sang môi trường mới; mật khẩu băm của bản cũ không được chép thẳng vào Supabase Auth. Chưa có thao tác đặt lại mật khẩu hoặc di chuyển dữ liệu thật nào được thực hiện.

## Quy mô 20.000 tài khoản và giới hạn kiểm tra

Danh sách quản trị được tìm kiếm tại cơ sở dữ liệu và tải 100 sinh viên mỗi trang. Sinh viên chỉ được đọc dữ liệu lớp mình; hồ sơ chi tiết và danh sách CCCD chỉ quản trị được xem. Cập nhật link có kiểm tra phiên bản; xóa lớp có xác nhận tên, số lượng liên quan và kiểm tra dữ liệu đã thay đổi.

Gói Free dùng cho thử một số lớp. Trước khi mở toàn trường, đo tải trên dự án thật, kiểm tra dung lượng/băng thông, hạn mức đăng nhập, thời gian tạo tài khoản, sao lưu và phục hồi. Chưa cam kết phục vụ 20.000 người truy cập đồng thời. Pro có sao lưu tự động; nếu dùng Free cần sao lưu riêng. [Giá và giới hạn Supabase](https://supabase.com/pricing).

Đã kiểm tra ở Windows: PostgreSQL/RLS qua PGlite; hàm quản lý tài khoản với các tình huống phân quyền; trình duyệt dùng SDK Supabase thật, SQL và Edge handler thật với cổng Auth giả lập tại máy; nhập Excel và tiếp tục sau lỗi mạng, đăng nhập, phân trang, cấp lại/đổi mật khẩu và giao diện điện thoại. **Chưa kiểm tra Supabase Auth/Edge được lưu trữ thật, DNS, HTTPS, cài PWA thực tế trên iPhone hoặc tải nhiều người đồng thời** vì chưa có tài khoản dịch vụ.

Các lệnh kiểm tra:

```powershell
npm ci
npm run test:cloud
npm run test:cloud:web
```

Mã SwiftUI trong `ios` và backend Python vẫn là bản cũ dùng API `/api`; chúng không tự kết nối Supabase. Hướng triển khai trong tài liệu này dùng PWA cho cả iPhone và quản trị máy tính.
