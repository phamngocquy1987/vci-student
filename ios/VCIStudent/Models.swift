import Foundation

struct StudentUser: Codable, Identifiable {
    let id: Int
    let username: String
    let full_name: String
    let role: String
    let class_id: Int?
    let class_code: String
    let campus: String
}

struct Lesson: Codable, Identifiable {
    let id: Int
    let class_id: Int
    let class_code: String
    let campus: String
    let date: String
    let start: String
    let end: String
    let subject: String
    let lecturer: String
    let room: String
    let kind: String
    let status: String
    let note: String
    let updated_at: String

    var statusTitle: String {
        switch status { case "nghi": return "Nghỉ học"; case "hoc_bu": return "Học bù"; default: return kind == "thi" ? "Lịch thi" : "Lịch học" }
    }
}

struct SchoolNotice: Codable, Identifiable {
    let id: Int
    let class_id: Int?
    let title: String
    let body: String
    let class_code: String
    let campus: String
    let created_at: String
}

struct LoginResult: Decodable {
    let token: String
    let user: StudentUser
}

struct MeResult: Decodable { let user: StudentUser }
struct OKResult: Decodable { let ok: Bool }
struct MetaResult: Decodable { let demo: Bool }

struct AcademicTimetableLink: Codable, Identifiable {
    let id: Int
    let class_id: Int
    let class_code: String
    let campus: String
    let academic_year: String
    let semester: String
    let kind: String
    let title: String
    let url: String
    let note: String
    let active: Bool
    let version: Int
    let updated_at: String
    var semesterTitle: String { ["1": "Học kỳ I", "2": "Học kỳ II", "summer": "Học kỳ hè"][semester] ?? semester }
    var driveURL: URL? {
        guard let value = URL(string: url), value.scheme?.lowercased() == "https",
              let host = value.host?.lowercased(), ["drive.google.com", "docs.google.com"].contains(host) else { return nil }
        return value
    }
}

enum VCIClock {
    static var calendar: Calendar {
        var value = Calendar(identifier: .gregorian)
        value.timeZone = TimeZone(identifier: "Asia/Ho_Chi_Minh")!
        value.firstWeekday = 2
        return value
    }
    static func monday(_ date: Date) -> Date {
        let day = calendar.startOfDay(for: date)
        let offset = (calendar.component(.weekday, from: day) + 5) % 7
        return calendar.date(byAdding: .day, value: -offset, to: day)!
    }
    static func adding(_ days: Int, to date: Date) -> Date { calendar.date(byAdding: .day, value: days, to: date)! }
    static func iso(_ date: Date) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = calendar; f.timeZone = calendar.timeZone; f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }
    static func date(_ value: String) -> Date? {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = calendar; f.timeZone = calendar.timeZone; f.dateFormat = "yyyy-MM-dd"
        return f.date(from: value)
    }
    static func label(_ date: Date, format: String = "dd/MM") -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "vi_VN")
        f.calendar = calendar; f.timeZone = calendar.timeZone; f.dateFormat = format
        return f.string(from: date)
    }
    static func timestamp(_ value: String) -> String {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let d = f.date(from: value) else { return String(value.prefix(10)) }
        return label(d, format: "HH:mm · dd/MM/yyyy")
    }
}
