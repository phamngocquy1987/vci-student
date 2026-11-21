import SwiftUI

struct HomeView: View {
    @EnvironmentObject var store: AppStore
    private var next: Lesson? {
        let today = VCIClock.iso(Date())
        let currentTime = VCIClock.label(Date(), format: "HH:mm")
        return store.lessons.first { $0.status != "nghi" && ($0.date > today || ($0.date == today && $0.end > currentTime)) }
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                BrandView()
                VStack(alignment: .leading, spacing: 6) {
                    Text("Xin chào, \(store.user?.full_name ?? "bạn")").font(.title2.bold())
                    Text("\(store.user?.class_code ?? "") · \(store.user?.campus ?? "")").foregroundStyle(.secondary)
                }
                ConnectionBanner()
                CampusWelcomeCard()
                WebsiteButton()
                AcademicTimetableView(kind: "hoc")
                if !store.lessons.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Buổi tiếp theo trong tuần đang xem").font(.headline)
                    Text("\(VCIClock.label(store.week)) – \(VCIClock.label(VCIClock.adding(6, to: store.week)))").font(.subheadline).foregroundStyle(.secondary)
                    if let next {
                        Text(VCIClock.label(VCIClock.date(next.date)!, format: "EEEE, dd/MM/yyyy")).font(.subheadline.weight(.medium))
                        LessonCard(lesson: next)
                    } else {
                        ContentUnavailableView("Chưa có buổi học tiếp theo", systemImage: "calendar.badge.checkmark", description: Text("Xem các tuần khác trong mục Lịch học."))
                    }
                }
                }
                Text("Thông báo gần đây").font(.title3.bold())
                ForEach(store.notices.prefix(3)) { notice in NoticeCard(notice: notice) }
                if store.notices.isEmpty { Text("Chưa có thông báo.").foregroundStyle(.secondary) }
            }.padding(20)
        }.background(VCITheme.background).navigationTitle("Trang chủ").navigationBarTitleDisplayMode(.inline)
            .refreshable { await store.load() }
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button { Task { await store.load() } } label: { Image(systemName: "arrow.clockwise") }.disabled(store.busy).accessibilityLabel("Làm mới") } }
    }
}

struct ScheduleView: View {
    @EnvironmentObject var store: AppStore
    let kind: String
    private var rows: [Lesson] { store.lessons.filter { $0.kind == kind } }
    private var days: [String] { Array(Set(rows.map(\.date))).sorted() }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ConnectionBanner()
                AcademicTimetableView(kind: kind)
                DisclosureGroup("Lịch từng buổi (tùy chọn)") {
                VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Button { Task { await store.moveWeek(-1) } } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }.accessibilityLabel("Tuần trước")
                    Spacer(minLength: 0)
                    VStack(spacing: 4) {
                        Text("\(VCIClock.label(store.week)) – \(VCIClock.label(VCIClock.adding(6, to: store.week)))").font(.headline)
                        Text(VCIClock.label(store.week, format: "yyyy")).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                    Button { Task { await store.moveWeek(1) } } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44) }.accessibilityLabel("Tuần sau")
                }.disabled(store.busy).background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
                Button("Về tuần hiện tại") { store.week = VCIClock.monday(Date()); Task { await store.load() } }.font(.subheadline).disabled(store.busy)
                if store.busy { ProgressView("Đang tải lịch…").frame(maxWidth: .infinity).padding() }
                ForEach(days, id: \.self) { day in
                    Text(VCIClock.label(VCIClock.date(day)!, format: "EEEE, dd/MM")).font(.headline).padding(.top, 8)
                    ForEach(rows.filter { $0.date == day }) { LessonCard(lesson: $0) }
                }
                if rows.isEmpty && !store.busy {
                    ContentUnavailableView(kind == "thi" ? "Chưa có lịch thi" : "Chưa có lịch học", systemImage: "calendar", description: Text(store.offline ? "Không có bản lưu cho tuần này. Kết nối mạng và thử lại." : "Nhà trường chưa công bố lịch cho tuần này hoặc lớp của bạn không có lịch."))
                }
                Text("Giờ hiển thị theo múi giờ Việt Nam. Kéo xuống để cập nhật.").font(.caption).foregroundStyle(.secondary)
                }
                }
            }.padding(20)
        }.background(VCITheme.background).navigationTitle(kind == "thi" ? "Lịch thi" : "Lịch học")
            .refreshable { await store.load() }
    }
}

struct NoticeCard: View {
    let notice: SchoolNotice
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(notice.class_code).font(.caption.bold()).foregroundStyle(VCITheme.primary)
                Spacer()
                Text(VCIClock.timestamp(notice.created_at)).font(.caption).foregroundStyle(.secondary)
            }
            Text(notice.title).font(.headline)
            Text(notice.body).font(.subheadline).foregroundStyle(.secondary)
        }.padding(18).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
            .accessibilityElement(children: .combine)
    }
}

struct NoticesView: View {
    @EnvironmentObject var store: AppStore
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ConnectionBanner()
                ForEach(store.notices) { NoticeCard(notice: $0) }
                if store.notices.isEmpty { ContentUnavailableView("Chưa có thông báo", systemImage: "bell", description: Text("Các thông báo của nhà trường sẽ xuất hiện tại đây.")) }
                Text("Thông báo được cập nhật khi mở hoặc làm mới ứng dụng. Bản này chưa hỗ trợ thông báo đẩy.").font(.caption).foregroundStyle(.secondary)
            }.padding(20)
        }.background(VCITheme.background).navigationTitle("Thông báo").refreshable { await store.load() }
    }
}

struct AccountView: View {
    @EnvironmentObject var store: AppStore
    @State private var passwordSheet = false
    @State private var logoutConfirmation = false
    var body: some View {
        Form {
            Section {
                LabeledContent("Họ và tên", value: store.user?.full_name ?? "")
                LabeledContent("Mã sinh viên", value: store.user?.username ?? "")
                LabeledContent("Lớp", value: store.user?.class_code ?? "")
                LabeledContent("Cơ sở", value: store.user?.campus ?? "")
            } header: { Text("Thông tin sinh viên") }
            Section {
                Button("Đổi mật khẩu") { passwordSheet = true }
                Text("Cần cập nhật thông tin hoặc được cấp lại mật khẩu? Liên hệ cán bộ phụ trách lớp.").font(.footnote).foregroundStyle(.secondary)
            }
            Section { WebsiteButton().listRowInsets(EdgeInsets()) }
            Section {
                Button("Đăng xuất", role: .destructive) { logoutConfirmation = true }
                Text("VCI Student · Phiên bản 0.1\nỨng dụng đang trong giai đoạn phát triển.").font(.caption).foregroundStyle(.secondary)
            }
        }.navigationTitle("Tài khoản")
            .sheet(isPresented: $passwordSheet) { PasswordView() }
            .confirmationDialog("Đăng xuất và xóa lịch đã lưu trên thiết bị?", isPresented: $logoutConfirmation, titleVisibility: .visible) {
                Button("Đăng xuất", role: .destructive) { Task { await store.logout() } }
            }
    }
}

struct PasswordView: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var old = ""
    @State private var new = ""
    @State private var confirm = ""
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("Mật khẩu hiện tại", text: $old).textContentType(.password)
                    SecureField("Mật khẩu mới", text: $new).textContentType(.newPassword)
                    SecureField("Nhập lại mật khẩu mới", text: $confirm).textContentType(.newPassword)
                } footer: { Text("Tối thiểu 10 ký tự. Sau khi đổi, bạn sẽ đăng nhập lại trên các thiết bị.") }
                if let error { Text(error).foregroundStyle(.red) }
                Button(busy ? "Đang lưu…" : "Đổi mật khẩu") {
                    guard new == confirm else { error = "Mật khẩu nhập lại không khớp."; return }
                    busy = true; error = nil
                    Task {
                        do { try await store.changePassword(old: old, new: new); dismiss() }
                        catch { self.error = error.localizedDescription }
                        busy = false
                    }
                }.disabled(busy || old.isEmpty || new.count < 10 || confirm.isEmpty)
            }.navigationTitle("Đổi mật khẩu").toolbar { ToolbarItem(placement: .cancellationAction) { Button("Đóng") { dismiss() } } }
        }
    }
}
