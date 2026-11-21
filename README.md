# VCI Student 1.0 — GitHub Pages + Supabase

Phương án triển khai hiện tại là app web cài trên màn hình iPhone và máy tính (PWA), giao diện lưu trên GitHub Pages, tài khoản và dữ liệu do Supabase quản lý. Không cần quyền quản trị CloudX, Mac hoặc đưa lên App Store cho phương án này.

**Bắt đầu tại [Hướng dẫn triển khai Supabase và GitHub](docs/TRIEN-KHAI-SUPABASE.md).** Tài liệu hướng dẫn từ tạo tài khoản miễn phí, chạy SQL phân quyền, triển khai chức năng tài khoản, tạo quản trị đầu tiên đến gắn `daotao.vci.edu.vn` và cài app.

Đã chuẩn bị mã nguồn; chưa triển khai lên tài khoản dịch vụ, chưa đổi DNS và chưa chuyển dữ liệu thật. `Start-Demo.cmd` tiếp tục mở bản Python/SQLite cũ để đối chiếu. Bản SwiftUI trong `ios` vẫn dùng API cũ; bản triển khai Supabase này dùng PWA cho iPhone.

## Các phần đã chuyển sang Supabase

- Đăng nhập bằng mã tài khoản/CCCD, khôi phục phiên, đăng xuất và đổi mật khẩu bằng Supabase Auth.
- Phân quyền ở PostgreSQL/RLS: sinh viên chỉ đọc dữ liệu lớp mình; quản trị xem danh sách và hồ sơ, tạo/sửa/xóa lớp có kiểm tra xác nhận.
- Link lịch học/lịch thi theo lớp, năm học và học kỳ; thêm/sửa/ẩn/công bố, kiểm tra phiên bản và tạo thông báo.
- Excel sinh viên đúng mẫu 9 cột, CCCD làm tài khoản và mật khẩu ban đầu; xem trước, kiểm tra lỗi phía cơ sở dữ liệu; tạo tối đa 5 tài khoản mỗi yêu cầu, tiếp tục bản nhập sau gián đoạn trong phiên trình duyệt.
- Tìm kiếm tên có/không dấu, CCCD và tên lớp tại máy chủ; tải 100 hồ sơ mỗi trang, STT liên tục. Không tải cả 20.000 hồ sơ vào trình duyệt khi mở app.
- Lịch từng buổi/Excel tùy chọn, thông báo lớp/toàn trường và nhật ký quản trị.
- Biểu tượng, manifest, hướng dẫn cài PWA trên iPhone và Windows; tài nguyên giao diện có bộ nhớ đệm, dữ liệu tài khoản/hồ sơ/API không lưu vào cache offline.
- Workflow GitHub Actions chỉ xuất bản tài nguyên giao diện, kiểm tra loại khóa công khai và loại dữ liệu riêng khỏi bộ đóng gói.

## Kiểm tra bản Supabase

```powershell
npm ci
npm run test:cloud
npm run test:cloud:web
```

SQL/RLS chạy kiểm tra bằng PostgreSQL trong PGlite. Luồng trình duyệt dùng SDK Supabase và Edge handler thật với cổng Auth giả lập tại máy; kiểm tra nhập Excel bị mất phản hồi rồi tiếp tục, phân trang, phân quyền và đổi/cấp lại mật khẩu. Chưa kiểm chứng Supabase Auth/Edge được lưu trữ thật, DNS, HTTPS, cài đặt trên iPhone thực hoặc tải nhiều người đồng thời. Kiểm tra 20.000 bản ghi giả chỉ xác nhận tìm kiếm/phân trang, không chứng minh khả năng phục vụ 20.000 người cùng lúc.

Các tệp chính: `web/` (kết nối Supabase và Excel), `supabase/migrations/` (bảng/phân quyền), `supabase/functions/vci-api/` (tạo/cấp lại tài khoản), `tools/build_cloud.mjs` (xuất bản dựng), `.github/workflows/pages.yml` (GitHub Pages). Không đưa Secret key/service_role key hoặc dữ liệu sinh viên vào kho GitHub.

---

# Tài liệu bản Python/SwiftUI cũ — lưu để đối chiếu

Ứng dụng iPhone cho sinh viên Trường Cao đẳng Công Thương Việt Nam, kèm trang quản trị và hệ thống dữ liệu. Đây là mã nguồn bản đầu, chưa được nhà trường xác nhận là ứng dụng chính thức.

## Những phần đã xây dựng

- **App iPhone bằng SwiftUI:** đăng nhập mã sinh viên; trang chủ có lối vào vci.edu.vn trong trình duyệt tích hợp; lịch học và lịch thi theo tuần; thông báo theo lớp/toàn trường; hồ sơ; đổi mật khẩu; lưu lịch đã tải theo tuần để đọc khi mất mạng; lưu phiên bằng Keychain.
- **Trang quản trị:** bảng tổng quan, tạo/sửa/xóa lớp theo cơ sở, tạo tài khoản sinh viên, cấp lại mật khẩu, xem/chỉnh sửa/báo nghỉ buổi học, đăng thông báo và xem nhật ký cập nhật.
- **Sinh viên từ Excel:** tải mẫu, nhập danh sách hàng loạt, xem trước và báo lỗi từng dòng, xác nhận mật khẩu ban đầu. Không ghi đè tài khoản cũ; có lỗi thì chưa tạo tài khoản nào.
- **Nhập Excel:** tải mẫu .xlsx, xem trước, báo lỗi từng dòng, kiểm tra trùng lớp/phòng/giảng viên, xác nhận công bố. Bản nháp hết hạn sau 24 giờ. Khi công bố, hệ thống kiểm tra trùng lần nữa và lưu toàn bộ trong một giao dịch.
- **Lịch theo học kỳ bằng link Drive:** tách thành hai mục **Lịch học** và **Lịch thi** trên menu quản trị và sinh viên. Mỗi mục gắn link theo lớp, năm học và học kỳ I/II/hè; có thêm, sửa, ẩn/công bố, số lần cập nhật, nhật ký và thông báo trong app cho đúng lớp. Loại lịch được xác định tự động theo mục đang mở. Lịch từng buổi trong phần tùy chọn cũng tách theo loại.
- **Cổng sinh viên trên web:** đăng nhập cùng tài khoản để xem lịch và thông báo. Có thể dùng để thử luồng dữ liệu ngay trên Windows trong lúc chuẩn bị bản iPhone.
- **Phân quyền ở máy chủ:** sinh viên chỉ đọc lịch của lớp mình kể cả khi thay đổi tham số yêu cầu; sinh viên không truy cập được chức năng quản trị. Mật khẩu được băm PBKDF2; phiên đăng nhập hết hạn sau 12 giờ.

## Chạy thử trên Windows

Cần Python 3.10 trở lên, kết nối Internet khi cài thư viện lần đầu.

1. Mở thư mục `VCI-Student` và nhấp đúp **Start-Demo.cmd**.
2. Chờ hệ thống chuẩn bị thư viện và tự mở trình duyệt.
3. Giữ cửa sổ đó mở khi dùng ứng dụng. Nếu trình duyệt chưa mở, truy cập **http://127.0.0.1:8765**.

Nếu đang ở PowerShell, chạy `E:\Ai\VCI-Student\Start-Demo.cmd`. Tệp `.cmd` không cần thay đổi chính sách chạy PowerShell. Tệp `Start-Demo.ps1` vẫn có thể dùng trên máy đã cho phép chạy PowerShell script.

Nếu máy không cho chạy tệp PowerShell, có thể nhập lần lượt các lệnh sau trong thư mục dự án; không cần thay đổi chính sách máy:

```powershell
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r backend/requirements.lock.txt
$env:PYTHONUTF8 = '1'
$env:VCI_DB = "$PWD/data/demo.sqlite3"
./.venv/Scripts/python.exe -m backend.manage seed-demo
./.venv/Scripts/python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8765
```

Lệnh tạo demo chỉ chạy lần đầu. Nếu đã có dữ liệu, hệ thống từ chối ghi đè. Dừng máy chủ bằng Ctrl+C.

| Tài khoản thử | Vai trò | Mật khẩu |
| --- | --- | --- |
| admin | Quản trị | VciDemo@2026 |
| SV001 | Sinh viên lớp CNTT-K18A, Hà Nội | VciDemo@2026 |
| SV002 | Sinh viên lớp QTKD-K18B, Hà Nội | VciDemo@2026 |

Đây là tài khoản minh họa trong database riêng. Không dùng database demo để vận hành dữ liệu sinh viên thật.

## Quản lý lớp và nhập sinh viên hàng loạt

Trong **Lớp & sinh viên**, mỗi lớp có nút **Sửa lớp** và **Xóa lớp**.

Bấm trực tiếp **tên lớp** để xem riêng danh sách sinh viên của đúng lớp và cơ sở đó. Trang tự cuộn tới danh sách, hiển thị cơ sở, năm và số sinh viên. Bấm **Xem tất cả lớp** để bỏ lọc lớp; bộ lọc năm vẫn được giữ. Lớp trùng mã ở các cơ sở được phân biệt bằng ID lớp.

**Tìm kiếm sinh viên:** nhập vào ô tìm kiếm ở cạnh bộ lọc năm; danh sách cập nhật ngay. Có thể chọn **Tất cả thông tin**, **Họ tên sinh viên**, **Số CCCD** hoặc **Tên lớp**. Hỗ trợ chữ hoa/thường, có dấu/không dấu và nhập một phần tên hoặc số. Mục tất cả còn tìm theo mã đăng nhập và cơ sở. Tìm CCCD dựa trên hồ sơ, kể cả tài khoản cũ có mã đăng nhập khác CCCD. Kết quả kết hợp với năm và lớp đang chọn, có số lượng phù hợp; STT đánh lại từ 1 theo kết quả. Bấm **Xóa tìm kiếm** để xóa từ khóa. Dữ liệu phục vụ tìm kiếm vẫn chỉ được API cung cấp cho quản trị.

**Năm quản lý:** khi thêm hoặc sửa lớp, chọn năm như 2024, 2025, 2026. Năm được hiển thị trong danh sách lớp và sinh viên; sinh viên theo năm của lớp đang học. Bộ lọc **Lọc theo năm** áp dụng cho cả hai danh sách, có lựa chọn **Tất cả năm** và **Chưa phân năm**. Lớp mới mặc định năm hiện tại (hoặc năm đang lọc). Dữ liệu cũ không tự đoán năm: vào **Sửa lớp** để gán đúng năm. Khi đổi năm, lịch học và tài khoản vẫn gắn với lớp; ngày học thực tế không bị đổi. Năm này dùng để phân nhóm quản lý; mã lớp vẫn duy nhất trong từng cơ sở.

- **Sửa lớp:** đổi mã/tên lớp hoặc cơ sở. Danh sách sinh viên, lịch học và thông báo vẫn thuộc lớp đó. Đổi cơ sở sẽ kiểm tra lại lịch trùng; bản Excel đang chờ xác nhận cần tải lại sau khi sửa lớp.
- **Chọn cơ sở:** cả thêm và sửa lớp dùng danh sách chọn: Hà Nội, Hồ Chí Minh, Đắk Lắk, Thái Nguyên, Cần Thơ, Bắc Ninh; không nhập tên cơ sở tự do.
- **Xóa lớp:** hộp thoại liệt kê số tài khoản, buổi học/lịch thi và thông báo riêng sẽ bị xóa. Phải nhập đúng mã lớp, đánh dấu đồng ý xóa tài khoản/dữ liệu liên quan nếu có, rồi bấm **Xóa vĩnh viễn**. Phiên đăng nhập của sinh viên bị xóa cũng bị thu hồi. Dữ liệu các lớp khác và thông báo toàn trường được giữ lại. Nếu dữ liệu thay đổi khi đang xác nhận, phải mở lại hộp thoại để kiểm tra.
- **Nhập sinh viên Excel:** bấm **Nhập sinh viên Excel**, chọn **Lớp nhận danh sách** (kèm cơ sở và năm), rồi bấm **Tải mẫu Excel sinh viên**. Mẫu theo bảng tham chiếu: `TT`, `Họ đệm`, `Tên`, `Ngày sinh`, `Nơi sinh`, `Giới tính`, `Dân tộc`, `Số CCCD`, `Ghi chú`, có phần tiêu đề nhà trường và dòng tổng. Thay dòng minh họa; giữ các tiêu đề cột. Có thể chèn thêm dòng phía trên dòng tổng. Hệ thống tìm hàng tiêu đề trong 30 dòng đầu; đọc dữ liệu ở sheet đầu tiên.
- **Thông tin nhập:** họ tên được ghép từ Họ đệm và Tên; chấp nhận Tên trống nếu toàn bộ họ tên nằm trong Họ đệm. Ngày sinh nhận ô ngày Excel hoặc DD/MM/YYYY. Số CCCD bắt buộc đủ 12 chữ số và không trùng trong file/hệ thống; nhập dạng văn bản để giữ số 0 đầu.
- **Tài khoản và hồ sơ:** với mẫu 9 cột, mã đăng nhập **và mật khẩu ban đầu** đều là Số CCCD của từng sinh viên, giữ nguyên đủ 12 chữ số. Bước xác nhận không có ô nhập mật khẩu chung. Các thông tin ngày sinh, nơi sinh, giới tính, dân tộc, CCCD và ghi chú được lưu vào hồ sơ. Bấm **Hồ sơ** ở dòng sinh viên để xem; chỉ quản trị được truy cập thông tin hồ sơ này. Mẫu 4 cột cũ vẫn được đọc để tương thích và vẫn cần mật khẩu chung do mẫu đó không có CCCD.
- Sau khi nhập thành công, bấm **Tải mã đăng nhập vừa tạo** để lưu file **.xlsx**. Cột mã đăng nhập (CCCD) có định dạng văn bản để Excel giữ số 0 đầu. File gồm mã đăng nhập, họ tên, lớp, cơ sở, năm; không xuất thêm cột mật khẩu. Liên kết tải dành cho quản trị thực hiện lần nhập đó và có hiệu lực trong 24 giờ.
- Chọn file `.xlsx`, bấm **Kiểm tra danh sách**, sửa các dòng bị báo lỗi nếu có. Khi hợp lệ, bấm **Tạo … tài khoản**. Sinh viên đăng nhập bằng CCCD ở cả hai ô, sau đó có thể đổi mật khẩu trong mục Tài khoản. Mật khẩu dùng để xác thực được băm riêng cho từng tài khoản. Tài khoản đã tồn tại không bị tự đổi tên hoặc đặt lại mật khẩu khi nhập lại file.
- Hỗ trợ tối đa 5 MB, 5.000 sinh viên/lần; mẫu mới nhập một lớp mỗi lần theo lựa chọn trên giao diện. Không nhận công thức. Tiêu đề lớp trong file phải khớp lớp đang chọn nếu có ghi rõ tên lớp. Bản xem trước hết hạn sau 24 giờ. Danh sách lớn có thể cần vài phút để tạo tài khoản.

Để nhận cập nhật khi hệ thống đang chạy: dừng bằng Ctrl+C, mở lại **Start-Demo.cmd**, rồi làm mới trình duyệt bằng Ctrl+F5. Hệ thống tự thêm bảng dữ liệu cần thiết, không cần tạo lại database demo.

## Lịch học bằng link Drive — cách quản lý chính

1. PĐT đưa file lịch gốc lên Google Drive hoặc Google Sheets. Có thể dùng link thư mục nếu lịch có nhiều bản hoặc nhiều tuần. Cấp quyền **Người xem** cho đúng nhóm/tài khoản sinh viên theo [hướng dẫn Google Drive](https://support.google.com/drive/answer/2494822?hl=vi). App không tự tải hai file đính kèm lên Drive hoặc tự đổi quyền chia sẻ.
2. Trong app quản trị, chọn **Lịch học → Thêm link lịch học** hoặc **Lịch thi → Thêm link lịch thi**.
3. Chọn **Lớp nhận lịch, Năm học (ví dụ 2026-2027), Học kỳ I/II/hè**, nhập tên tài liệu và dán link Drive/Google Sheets. Không cần chọn loại lịch: mỗi mục tự xác định đúng loại. Ghi chú có thể nêu sheet cần mở, cơ sở hoặc tuần áp dụng.
4. Đánh dấu **Công bố cho sinh viên của lớp** rồi **Lưu link lịch**. Bỏ đánh dấu để giữ bản ẩn. Sinh viên chỉ được API trả về các link đã công bố của lớp mình.
5. Dùng **Sửa link** khi đổi tài liệu hoặc ghi chú; dùng **Ẩn lịch / Công bố** để thay trạng thái. App kiểm tra phiên bản đang sửa để tránh ghi đè cập nhật từ cửa sổ khác. Một lớp có một link cho mỗi bộ năm học + học kỳ + loại lịch; dùng link thư mục nếu cần nhiều tài liệu trong cùng kỳ. Một tài liệu chung có thể được gắn riêng cho nhiều lớp.

**Sinh viên:** chọn mục **Lịch học** hoặc **Lịch thi**, chọn năm học/học kỳ rồi bấm **Mở lịch trên Drive**. Mỗi mục chỉ hiện đúng loại lịch; trang tổng quan có lối vào Lịch thi riêng. Cấp quyền trên Drive là bước độc lập với phân quyền trong app. Nếu Drive báo cần quyền truy cập, PĐT cần kiểm tra bằng tài khoản sinh viên. Việc lưu link chỉ kiểm tra URL HTTPS thuộc Drive/Google Docs; chưa xác minh file có tồn tại hoặc mở được với từng sinh viên.

**Khi cập nhật:** sửa nội dung cùng file Drive sẽ giữ link; đổi sang file khác thì dùng Sửa link trong app. Thông báo trong app được tạo khi quản trị lưu thay đổi hoặc đổi trạng thái công bố. Sửa trực tiếp nội dung trên Drive không tự tạo thông báo trong app và không thay thời điểm cập nhật trong app. Nội dung file gốc vẫn do PĐT trình bày; app không tự chuyển thành từng buổi, kiểm tra trùng giờ hoặc nhắc giờ học từ link này. Không tự lưu file Drive để đọc ngoại tuyến.

Phần **Lịch từng buổi (tùy chọn)** chứa cách nhập lịch Excel cũ và lịch theo tuần. Dữ liệu lịch đã có được giữ nguyên. Khi xóa lớp, hộp xác nhận tính cả số link lịch liên quan; xóa link trong app không xóa file trên Drive.

Mã nguồn iPhone đã bổ sung tài liệu theo năm học/học kỳ, mở Drive, lọc loại lịch học/lịch thi và lưu thông tin link trong cache. **Chưa biên dịch/chạy lại trên Xcode hoặc iPhone** trong môi trường Windows; cần kiểm tra trên Mac trước khi phát hành.

## Thử nhập lịch Excel theo từng buổi — tùy chọn

1. Đăng nhập quản trị và vào **Lớp & sinh viên** để tạo đúng mã lớp và tên cơ sở.
2. Mở **Lịch từng buổi (tùy chọn)** rồi chọn **Nhập lịch từ Excel → Tải mẫu Excel**.
3. Thay dòng minh họa bằng lịch thực tế. Mỗi dòng là một buổi, tiêu đề nằm ở dòng đầu của sheet đầu tiên.
4. Chọn file, bấm **Kiểm tra & xem trước**. Nếu có lỗi, sửa trong Excel rồi chọn lại file.
5. Kiểm tra các dòng và bấm **Công bố**. Đăng nhập SV001 ở cửa sổ khác để xem thay đổi.

| Cột bắt buộc | Cách nhập |
| --- | --- |
| Lớp | Mã lớp đúng như trong trang quản trị |
| Cơ sở | Tên cơ sở đúng như trong trang quản trị |
| Ngày | Ô ngày Excel, `2026-11-23` hoặc `23/11/2026` |
| Bắt đầu / Kết thúc | Ô giờ Excel hoặc `07:30` / `10:00` |
| Môn học | Tên môn học |
| Giảng viên | Tên hoặc mã giảng viên thống nhất giữa các lớp |
| Phòng | Tên phòng; phân biệt theo cơ sở |
| Loại | `hoc` hoặc `thi` |
| Trạng thái | `hoc`, `nghi` hoặc `hoc_bu` |
| Ghi chú | Giữ cột này, có thể để ô trống |

Hỗ trợ .xlsx, tối đa 5 MB và 5.000 dòng. .xls cần lưu lại thành .xlsx. Không nhận công thức: hãy dán giá trị trước khi tải. Lịch dạng ma trận (thứ nằm ngang, lớp nằm dọc), ô gộp hoặc dùng tiết học cần bổ sung bộ chuyển đổi theo file thật của trường.

**Quy tắc cập nhật:** cùng lớp + ngày + giờ bắt đầu + loại sẽ cập nhật buổi cũ. Các buổi khác được giữ lại; nhập lại file không xóa cả tuần. Để đổi ngày/giờ bắt đầu/lớp/loại, báo nghỉ buổi cũ rồi tạo buổi mới. Khi kiểm tra trùng, buổi nghỉ không chiếm phòng; các buổi nối tiếp nhau không bị tính là trùng.

## Mở dự án iPhone trên máy Mac

1. Chép thư mục `ios` sang máy Mac có Xcode hỗ trợ iOS 17 trở lên.
2. Mở `ios/VCIStudent.xcodeproj`. Dự án không cần cài thư viện Swift bên ngoài.
3. Chọn target VCIStudent → Signing & Capabilities → chọn Team và mã ứng dụng thuộc tài khoản của đơn vị triển khai.
4. Chọn Simulator hoặc iPhone đã kết nối và bấm Run.
5. Trong app, bấm **Cấu hình kết nối máy chủ** rồi nhập địa chỉ hệ thống đang chạy.

Đã kèm `project.yml` để tái tạo dự án bằng XcodeGen nếu cần. Có thể tái tạo `.xcodeproj` bằng `python tools/generate_xcode_project.py` trước khi cấu hình signing; thao tác tái tạo sẽ thay tệp cấu hình dự án.

**Địa chỉ thử nghiệm:**

- Simulator và hệ thống dữ liệu cùng máy Mac: `http://127.0.0.1:8765`.
- Máy chủ chạy trên Windows, app chạy trên Mac/iPhone: hai máy cùng mạng; chạy máy chủ với `--host 0.0.0.0`, dùng IP mạng nội bộ của Windows và chỉ cho phép kết nối trong mạng thử nghiệm. Không dùng 127.0.0.1 để kết nối sang máy khác.
- Bản Release yêu cầu máy chủ HTTPS; quyền cho phép HTTP chỉ có ở cấu hình Debug.

**Giới hạn kiểm chứng:** mã Swift và cấu hình dự án đã được tạo nhưng chưa biên dịch hoặc chạy trên Xcode/iPhone vì môi trường xây dựng hiện tại là Windows. Chưa có tệp cài .ipa, chưa đưa lên TestFlight/App Store. Cần kiểm tra thực tế trên Mac, ký ứng dụng và kiểm tra bản Archive trước khi phát hành.

## Chuẩn bị vận hành chính thức

1. Nhận file Excel mẫu và bảng quy đổi tiết/giờ; xác nhận cách quản lý lớp, cơ sở và lịch thi.
2. Dùng database mới qua biến `VCI_DB`, cài thư viện và tạo tài khoản bằng `python -m backend.manage create-admin --username <tên>`. Mật khẩu nhập trực tiếp; không có mật khẩu mặc định ở môi trường chính thức.
3. Cài hệ thống trên máy chủ HTTPS, giữ database ngoài thư mục công khai và sao lưu bằng `python -m backend.manage backup <file-sao-lưu-mới.sqlite3>`.
4. Thử khôi phục bằng bản sao database, xác nhận phân quyền và kiểm tra trên iPhone trước khi mở cho sinh viên.
5. Chuẩn bị tài khoản Apple Developer của đơn vị, tên miền, biểu tượng, nội dung hỗ trợ và thông tin quyền riêng tư phù hợp với dữ liệu triển khai.

SQLite và giới hạn đăng nhập trong bộ nhớ hiện phù hợp bản thử nhỏ, một tiến trình. Trước khi chạy nhiều máy chủ/tiến trình cần dùng hệ thống giới hạn đăng nhập dùng chung và đánh giá lại dữ liệu, tải sử dụng, sao lưu. Nếu đặt sau reverse proxy, chuyển đúng scheme/host và chỉ tin proxy nội bộ để cookie HTTPS và kiểm tra Origin hoạt động đúng.

## Những phần chưa có trong bản này

- Thông báo đẩy qua Apple: hiện có hộp thông báo trong app và tự làm mới khi mở lại, chưa có APNs.
- Tự lấy danh sách tin/bài từ website: hiện mở website chính thức trong app; cần quyền kết nối/API hoặc nguồn tin được trường xác nhận để đồng bộ nội dung.
- Điểm danh, điểm số, học phí, phụ huynh và đăng ký học phần.
- Phân quyền cán bộ theo từng cơ sở, tài khoản giảng viên, duyệt nhiều cấp; hiện quản trị được phép quản lý toàn hệ thống.
- Cơ chế đổi mật khẩu bắt buộc ở lần đăng nhập đầu, xác thực nhiều bước cho quản trị và phục hồi mật khẩu qua email/SMS.
- Danh mục giảng viên/phòng có mã định danh riêng: bản đầu phát hiện trùng bằng tên đã chuẩn hóa; cần thống nhất cách nhập và xử lý người trùng tên.

## Kiểm thử và cấu trúc

```powershell
./.venv/Scripts/python.exe -m pytest -q
npm.cmd ci
npm.cmd run test:web
```

Kiểm thử trình duyệt chạy Chrome có sẵn, tự tạo database demo riêng và máy chủ tạm ở cổng 8766; không thay đổi dữ liệu demo đang dùng. Có thể đặt `CHROME_PATH` nếu Chrome ở đường dẫn khác. Ảnh giao diện được lưu trong `test-results`.

Đã kiểm tra tại Windows: **58 kiểm thử API đạt**, gồm quyền xem link theo lớp, ẩn/công bố, phiên bản khi sửa, năm học/học kỳ, URL hợp lệ, thông báo và xóa lớp có link liên quan. Luồng trình duyệt đạt: thêm/sửa link, ẩn/công bố, sinh viên nhận đúng link cập nhật, lọc học kỳ, cùng các chức năng lớp/sinh viên, tìm kiếm, nhập Excel và đăng nhập hiện có. Link trong kiểm thử là dữ liệu giả để kiểm tra URL/luồng app; không dùng để xác nhận quyền truy cập Drive thực tế. App iPhone chưa kiểm thử bằng Xcode.

```text
admin/                       Giao diện quản trị và cổng sinh viên web
backend/                     API, dữ liệu SQLite, đọc Excel, công cụ quản trị
ios/VCIStudent/              Mã SwiftUI của app iPhone
ios/VCIStudent.xcodeproj/    Dự án mở bằng Xcode
tests/                       Kiểm thử API và trình duyệt
tools/                       Công cụ tạo cấu hình dự án iPhone
Start-Demo.ps1               Khởi chạy bản thử Windows
```

Tài liệu tham chiếu: [SwiftUI](https://developer.apple.com/swiftui/), [Xcode](https://developer.apple.com/xcode/), [FastAPI](https://fastapi.tiangolo.com/), [openpyxl](https://openpyxl.readthedocs.io/en/stable/tutorial.html).

## Nhận diện giao diện bản 0.8

Đã thay logo bằng logo chính thức do nhà trường cung cấp; dùng ảnh khuôn viên ở trang đăng nhập và phần chào mừng. Màu chủ đạo xanh lá, nền trắng và điểm nhấn vàng. Giao diện quản trị, cổng sinh viên và mã SwiftUI iPhone đã đồng bộ nhận diện.

Ảnh sử dụng là bản tối ưu dung lượng trong `admin/brand` và `ios/VCIStudent/Assets.xcassets`; ảnh gốc không bị thay đổi. Dự án iPhone đã có bộ tài nguyên logo, nền và biểu tượng AppIcon 1024 × 1024. Chưa biên dịch bằng Xcode trên Windows.

Kiểm tra trình duyệt trên máy tính và kích thước điện thoại đã đạt, bao gồm tải ảnh, đăng nhập, tìm kiếm, nhập Excel và quản lý lịch. Khi mở bản đang chạy tại http://127.0.0.1:8765, nhấn Ctrl+F5 để tải giao diện mới.
