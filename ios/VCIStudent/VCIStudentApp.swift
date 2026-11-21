import SwiftUI

@main
struct VCIStudentApp: App {
    @StateObject private var store = AppStore()
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            Group {
                if store.restoring {
                    ProgressView("Đang mở VCI Student…")
                } else if store.user == nil {
                    LoginView()
                } else {
                    StudentTabs()
                }
            }
            .environmentObject(store)
            .environment(\.locale, Locale(identifier: "vi_VN"))
            .environment(\.timeZone, VCIClock.calendar.timeZone)
            .tint(VCITheme.primary)
            .task { await store.restore() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active && store.user != nil && !store.busy {
                    Task { await store.load() }
                }
            }
        }
    }
}

struct StudentTabs: View {
    var body: some View {
        TabView {
            NavigationStack { HomeView() }.tabItem { Label("Trang chủ", systemImage: "house.fill") }
            NavigationStack { ScheduleView(kind: "hoc") }.tabItem { Label("Lịch học", systemImage: "calendar") }
            NavigationStack { ScheduleView(kind: "thi") }.tabItem { Label("Lịch thi", systemImage: "graduationcap") }
            NavigationStack { NoticesView() }.tabItem { Label("Thông báo", systemImage: "bell") }
            NavigationStack { AccountView() }.tabItem { Label("Tài khoản", systemImage: "person.crop.circle") }
        }
    }
}
