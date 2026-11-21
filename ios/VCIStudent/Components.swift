import SwiftUI
import SafariServices

enum VCITheme {
    static let primary = Color(red: 0.031, green: 0.388, blue: 0.267)
    static let gold = Color(red: 0.929, green: 0.776, blue: 0.357)
    static let background = Color(.systemGroupedBackground)
}

struct CampusBackdrop: View {
    var body: some View {
        GeometryReader { geometry in
            Image("CampusBackground").resizable().scaledToFill()
                .frame(width: geometry.size.width, height: geometry.size.height).clipped()
                .overlay(LinearGradient(colors: [VCITheme.primary.opacity(0.9), VCITheme.primary.opacity(0.55)], startPoint: .leading, endPoint: .trailing))
        }.accessibilityHidden(true).allowsHitTesting(false)
    }
}

struct CampusWelcomeCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("TRƯỜNG CAO ĐẲNG CÔNG THƯƠNG VIỆT NAM").font(.caption.weight(.semibold)).foregroundStyle(VCITheme.gold)
            Text("Cùng bạn kiến tạo tương lai").font(.title2.bold()).foregroundStyle(.white)
            Text("Lịch học, lịch thi và thông tin nhà trường, luôn trong tầm tay.").font(.subheadline).foregroundStyle(.white.opacity(0.95))
        }.padding(22).frame(maxWidth: .infinity, minHeight: 180, alignment: .leading)
            .background(CampusBackdrop()).clipShape(RoundedRectangle(cornerRadius: 22))
    }
}

struct AcademicTimetableView: View {
    @EnvironmentObject var store: AppStore
    let kind: String
    @State private var year = ""
    @State private var semester = ""
    private var available: [AcademicTimetableLink] { store.timetableLinks.filter { $0.kind == kind } }
    private var years: [String] { Array(Set(available.map(\.academic_year))).sorted(by: >) }
    private var rows: [AcademicTimetableLink] { available.filter { (year.isEmpty || $0.academic_year == year) && (semester.isEmpty || $0.semester == semester) } }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(kind == "thi" ? "Lịch thi theo học kỳ" : "Lịch học theo học kỳ").font(.title3.bold())
            HStack {
                Picker("Năm học", selection: $year) {
                    Text("Tất cả năm học").tag("")
                    ForEach(years, id: \.self) { Text($0).tag($0) }
                }.pickerStyle(.menu)
                Picker("Học kỳ", selection: $semester) {
                    Text("Tất cả học kỳ").tag("")
                    Text("Học kỳ I").tag("1")
                    Text("Học kỳ II").tag("2")
                    Text("Học kỳ hè").tag("summer")
                }.pickerStyle(.menu)
            }
            ForEach(rows) { link in
                VStack(alignment: .leading, spacing: 12) {
                    Text("\(link.academic_year) · \(link.semesterTitle)").font(.subheadline.weight(.semibold)).foregroundStyle(VCITheme.primary)
                    Text(link.title).font(.headline)
                    Text("\(link.class_code) · \(link.campus)").font(.subheadline).foregroundStyle(.secondary)
                    if !link.note.isEmpty { Text(link.note).font(.subheadline) }
                    Text("Cập nhật: \(VCIClock.timestamp(link.updated_at)) · Lần \(link.version)").font(.caption).foregroundStyle(.secondary)
                    if let url = link.driveURL {
                        Link(destination: url) { Label("Mở lịch trên Google Drive", systemImage: "doc.text") }.buttonStyle(.borderedProminent)
                    }
                }.padding(18).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
            }
            if rows.isEmpty {
                Text("Nhà trường chưa công bố link lịch phù hợp. Kéo xuống để làm mới hoặc chọn học kỳ khác.").font(.subheadline).foregroundStyle(.secondary)
            }
            Text("Mở tài liệu Drive cần kết nối mạng và quyền xem. Nếu không mở được, liên hệ phòng đào tạo.").font(.caption).foregroundStyle(.secondary)
        }
    }
}

struct BrandView: View {
    var body: some View {
        HStack(spacing: 12) {
            Image("SchoolLogo").resizable().scaledToFit()
                .frame(width: 56, height: 56).padding(5)
                .background(.white, in: RoundedRectangle(cornerRadius: 16))
                .accessibilityLabel("Logo Trường Cao đẳng Công Thương Việt Nam")
            VStack(alignment: .leading, spacing: 3) {
                Text("VCI Student").font(.title2.bold())
                Text("Cùng bạn đến tương lai").font(.caption)
            }
        }
    }
}

struct ConnectionBanner: View {
    @EnvironmentObject var store: AppStore
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if store.demo {
                Label("Dữ liệu minh họa · Chưa kết nối hệ thống chính thức", systemImage: "info.circle")
                    .font(.footnote).foregroundStyle(.orange)
            }
            if let error = store.error {
                Label(error, systemImage: "wifi.exclamationmark").font(.footnote).foregroundStyle(.red)
            }
            if let updatedAt = store.updatedAt {
                Text("\(store.offline ? "Bản lưu gần nhất" : "Đã cập nhật"): \(VCIClock.label(updatedAt, format: "HH:mm · dd/MM/yyyy"))")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct LessonCard: View {
    let lesson: Lesson
    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 5) {
                Text(lesson.start).font(.headline)
                Text(lesson.end).font(.subheadline).foregroundStyle(.secondary)
            }.frame(minWidth: 52, alignment: .leading)
            Rectangle().fill(lesson.status == "nghi" ? Color.red : VCITheme.gold).frame(width: 3)
            VStack(alignment: .leading, spacing: 9) {
                Text(lesson.subject).font(.headline)
                Text(lesson.statusTitle).font(.caption.bold())
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .foregroundStyle(lesson.status == "nghi" ? Color.red : VCITheme.primary)
                    .background((lesson.status == "nghi" ? Color.red : VCITheme.primary).opacity(0.08), in: Capsule())
                Label("Phòng \(lesson.room) · \(lesson.campus)", systemImage: "mappin.and.ellipse")
                Label(lesson.lecturer, systemImage: "person")
                if !lesson.note.isEmpty { Text(lesson.note).foregroundStyle(.secondary) }
            }.font(.subheadline)
            Spacer(minLength: 0)
        }
        .padding(18).fixedSize(horizontal: false, vertical: true)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .combine)
    }
}

struct WebsiteView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: URL(string: "https://vci.edu.vn")!)
    }
    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}

struct WebsiteButton: View {
    @State private var showing = false
    var body: some View {
        Button { showing = true } label: {
            HStack(spacing: 15) {
                Image(systemName: "globe.asia.australia.fill").font(.title)
                VStack(alignment: .leading, spacing: 5) {
                    Text("Kết nối nhà trường").font(.headline)
                    Text("Tin tức, tuyển sinh · vci.edu.vn").font(.subheadline)
                }
                Spacer(minLength: 0)
            }.padding(20).foregroundStyle(.white)
                .background(VCITheme.primary, in: RoundedRectangle(cornerRadius: 18))
        }.buttonStyle(.plain).sheet(isPresented: $showing) { WebsiteView().ignoresSafeArea() }
    }
}
