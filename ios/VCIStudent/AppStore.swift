import SwiftUI
import CryptoKit

private struct WeekCache: Codable {
    let user: StudentUser
    let lessons: [Lesson]
    let notices: [SchoolNotice]
    let timetableLinks: [AcademicTimetableLink]?
    let savedAt: Date
}

@MainActor
final class AppStore: ObservableObject {
    @Published var user: StudentUser?
    @Published var lessons: [Lesson] = []
    @Published var notices: [SchoolNotice] = []
    @Published var timetableLinks: [AcademicTimetableLink] = []
    @Published var week = VCIClock.monday(Date())
    @Published var busy = false
    @Published var restoring = true
    @Published var error: String?
    @Published var offline = false
    @Published var demo = false
    @Published var updatedAt: Date?
    @Published var server: String
    private var token = TokenVault.read()
    private let session: URLSession

    init() {
        #if DEBUG
        server = UserDefaults.standard.string(forKey: "vci.server") ?? "http://127.0.0.1:8765"
        #else
        server = UserDefaults.standard.string(forKey: "vci.server") ?? ""
        #endif
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.timeoutIntervalForRequest = 15
        session = URLSession(configuration: config)
    }

    func setServer(_ value: String) throws {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: trimmed), let host = url.host, !host.isEmpty,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.path.isEmpty else { throw failure("Nhập địa chỉ máy chủ, ví dụ https://lich.tenmiencuatruong.vn (không kèm đường dẫn).") }
        #if DEBUG
        guard ["https", "http"].contains(url.scheme ?? "") else { throw failure("Địa chỉ phải bắt đầu bằng http:// hoặc https://.") }
        #else
        guard url.scheme == "https" else { throw failure("Bản chính thức yêu cầu máy chủ HTTPS.") }
        #endif
        if server != trimmed { clearSession() }
        server = trimmed
        UserDefaults.standard.set(trimmed, forKey: "vci.server")
    }

    private func failure(_ message: String) -> NSError { NSError(domain: "VCI", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }

    private func request<T: Decodable>(_ path: String, method: String = "GET", body: [String: String]? = nil) async throws -> T {
        guard let url = URL(string: server + "/api" + path), url.host != nil else { throw failure("Vui lòng cấu hình địa chỉ máy chủ.") }
        var request = URLRequest(url: url)
        request.httpMethod = method
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body { request.httpBody = try JSONEncoder().encode(body); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw failure("Phản hồi không hợp lệ.") }
        guard (200...299).contains(http.statusCode) else {
            if http.statusCode == 401 && path != "/login" { clearSession() }
            let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            throw failure(object?["detail"] as? String ?? "Không thể thực hiện yêu cầu (\(http.statusCode)).")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    func login(username: String, password: String) async {
        busy = true; error = nil
        defer { busy = false }
        do {
            let result: LoginResult = try await request("/login", method: "POST", body: ["username": username, "password": password])
            guard result.user.role == "student" else {
                token = result.token
                let _: OKResult? = try? await request("/logout", method: "POST")
                clearSession()
                throw failure("App dành cho sinh viên. Cán bộ sử dụng trang quản trị trên trình duyệt.")
            }
            try TokenVault.save(result.token)
            token = result.token; user = result.user
            UserDefaults.standard.set(try JSONEncoder().encode(result.user), forKey: "vci.cachedUser")
            week = VCIClock.monday(Date())
            await load()
        } catch { self.error = error.localizedDescription }
    }

    func restore() async {
        defer { restoring = false }
        guard token != nil else { return }
        if let data = UserDefaults.standard.data(forKey: "vci.cachedUser") { user = try? JSONDecoder().decode(StudentUser.self, from: data) }
        do {
            let result: MeResult = try await request("/me")
            guard result.user.role == "student" else { clearSession(); return }
            user = result.user
            await load()
        } catch {
            if user != nil { readCache(); offline = true }
            self.error = error.localizedDescription
        }
    }

    func load() async {
        guard let user else { return }
        let requestedWeek = week
        let start = VCIClock.iso(requestedWeek), end = VCIClock.iso(VCIClock.adding(6, to: requestedWeek))
        busy = true; error = nil
        defer { busy = false }
        do {
            async let fetchedLessons: [Lesson] = request("/schedules?start=\(start)&end=\(end)")
            async let fetchedNotices: [SchoolNotice] = request("/notices")
            async let fetchedMeta: MetaResult = request("/meta")
            async let fetchedLinks: [AcademicTimetableLink] = request("/timetable-links")
            let (newLessons, newNotices, meta, newLinks) = try await (fetchedLessons, fetchedNotices, fetchedMeta, fetchedLinks)
            guard self.user?.id == user.id, self.week == requestedWeek else { return }
            lessons = newLessons; notices = newNotices; demo = meta.demo; offline = false; updatedAt = Date()
            timetableLinks = newLinks
            let cache = WeekCache(user: user, lessons: lessons, notices: notices, timetableLinks: timetableLinks, savedAt: updatedAt!)
            if let url = cacheURL(week: requestedWeek) { try? JSONEncoder().encode(cache).write(to: url, options: [.atomic, .completeFileProtection]) }
        } catch {
            guard self.user?.id == user.id, self.week == requestedWeek else { return }
            readCache(); offline = true; self.error = "Chưa tải được dữ liệu mới. " + error.localizedDescription
        }
    }

    func moveWeek(_ offset: Int) async {
        guard !busy else { return }
        week = VCIClock.adding(offset * 7, to: week)
        lessons = []; updatedAt = nil
        await load()
    }

    private func cacheURL(week: Date) -> URL? {
        guard let user, let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return nil }
        let key = SHA256.hash(data: Data("\(server)|\(user.id)|\(VCIClock.iso(week))".utf8)).map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent("vci-\(key).json")
    }

    private func readCache() {
        guard let url = cacheURL(week: week), let data = try? Data(contentsOf: url),
              let cache = try? JSONDecoder().decode(WeekCache.self, from: data), cache.user.id == user?.id else {
            lessons = []; notices = []; timetableLinks = []; updatedAt = nil; return
        }
        lessons = cache.lessons; notices = cache.notices; updatedAt = cache.savedAt
        timetableLinks = cache.timetableLinks ?? []
    }

    private func clearSession() {
        TokenVault.clear(); token = nil; user = nil; lessons = []; notices = []; timetableLinks = []; error = nil
        updatedAt = nil; offline = false; demo = false
        UserDefaults.standard.removeObject(forKey: "vci.cachedUser")
        if let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first,
           let urls = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
            for url in urls where url.lastPathComponent.hasPrefix("vci-") { try? FileManager.default.removeItem(at: url) }
        }
    }

    func logout() async {
        let _: OKResult? = try? await request("/logout", method: "POST")
        clearSession()
    }

    func changePassword(old: String, new: String) async throws {
        guard new.count >= 10 else { throw failure("Mật khẩu mới cần ít nhất 10 ký tự.") }
        let _: OKResult = try await request("/password", method: "POST", body: ["old_password": old, "new_password": new])
        clearSession()
    }
}
