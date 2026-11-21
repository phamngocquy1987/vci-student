import SwiftUI

struct LoginView: View {
    @EnvironmentObject var store: AppStore
    @State private var username = ""
    @State private var password = ""
    @State private var showingServer = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    VStack(alignment: .leading, spacing: 30) {
                        BrandView()
                        Text("Mỗi ngày học tập.\nMột bước tiến xa.").font(.largeTitle.bold())
                        Text("TRƯỜNG CAO ĐẲNG\nCÔNG THƯƠNG VIỆT NAM").font(.footnote.weight(.semibold)).lineSpacing(4)
                    }.padding(28).frame(maxWidth: .infinity, alignment: .leading)
                        .foregroundStyle(.white).background(CampusBackdrop()).clipShape(RoundedRectangle(cornerRadius: 24))
                    VStack(alignment: .leading, spacing: 16) {
                        Text("Đăng nhập sinh viên").font(.title2.bold())
                        TextField("Mã sinh viên", text: $username).textContentType(.username)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                            .padding().background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
                        SecureField("Mật khẩu", text: $password).textContentType(.password)
                            .padding().background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
                        if let error = store.error { Text(error).font(.footnote).foregroundStyle(.red).accessibilityAddTraits(.updatesFrequently) }
                        Button {
                            Task { await store.login(username: username.trimmingCharacters(in: .whitespacesAndNewlines), password: password) }
                        } label: {
                            HStack { Spacer(); if store.busy { ProgressView().tint(.white) }; Text(store.busy ? "Đang kết nối…" : "Đăng nhập"); Spacer() }.padding(8)
                        }.buttonStyle(.borderedProminent)
                            .disabled(store.busy || username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || password.isEmpty)
                        Text("Tài khoản do nhà trường cấp. Nếu quên mật khẩu, liên hệ cán bộ phụ trách lớp.")
                            .font(.footnote).foregroundStyle(.secondary)
                        Button("Cấu hình kết nối máy chủ") { showingServer = true }.font(.footnote)
                    }
                    WebsiteButton()
                }.padding(20)
            }.background(VCITheme.background).sheet(isPresented: $showingServer) { ServerSettingsView() }
        }
    }
}

struct ServerSettingsView: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var address = ""
    @State private var error: String?
    var body: some View {
        NavigationStack {
            Form {
                Section("Địa chỉ máy chủ VCI") {
                    TextField("https://…", text: $address).keyboardType(.URL)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                }
                Section {
                    Text("Nhập địa chỉ do đơn vị triển khai cung cấp. Dữ liệu đăng nhập sẽ được gửi đến máy chủ này.")
                    #if DEBUG
                    Text("Thử trên Simulator cùng máy: http://127.0.0.1:8765. Với iPhone thật, dùng địa chỉ mạng nội bộ của máy chạy hệ thống; 127.0.0.1 trên iPhone là chính điện thoại.")
                    #endif
                }.font(.footnote)
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }.navigationTitle("Kết nối máy chủ")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Đóng") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) { Button("Lưu") {
                        do { try store.setServer(address); dismiss() } catch { self.error = error.localizedDescription }
                    } }
                }.onAppear { address = store.server }
        }
    }
}
