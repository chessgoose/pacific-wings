import Foundation
import Vision
import CoreGraphics
import ImageIO

struct Mission {
    let id: String
    let date: String
    let squadron: String
    let sourceFront: String
    let scanFrontPath: String
}

struct OCRResult: Codable {
    let id: String
    let date: String
    let squadron: String
    let sourceFront: String
    let scanFrontPath: String
    let recognizedText: String
    let normalizedText: String
    let extractedDate: String?
    let extractedSquadron: String?
    let dateMatchesId: Bool
    let squadronMatchesId: Bool
}

func normalizeSquadron(_ value: String) -> String? {
    let lower = value.lowercased()
    if lower.contains("81") { return "81" }
    if lower.contains("82") { return "82" }
    if lower.contains("83") { return "83" }
    if lower.contains("434") || lower.contains("484") { return "434" }
    return nil
}

func squadronFromMissionID(_ id: String) -> String? {
    if id.hasPrefix("81BS_") { return "81" }
    if id.hasPrefix("82BS_") { return "82" }
    if id.hasPrefix("83BS_") { return "83" }
    if id.hasPrefix("434BS_") || id.hasPrefix("484BS_") { return "434" }
    return nil
}

func dateFromMissionID(_ id: String) -> String? {
    let pattern = #"(19\d{2}-\d{2}-\d{2})"#
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
    let ns = id as NSString
    guard let match = regex.firstMatch(in: id, range: NSRange(location: 0, length: ns.length)) else { return nil }
    return ns.substring(with: match.range(at: 1))
}

func loadMissions(from path: String) throws -> [Mission] {
    let text = try String(contentsOfFile: path, encoding: .utf8)
    let pattern = #""id":\s*"([^"]+)"[\s\S]*?"date":\s*"([^"]*)"[\s\S]*?"squadron":\s*"([^"]*)"[\s\S]*?"sourceFront":\s*"([^"]*)"[\s\S]*?"scanFrontPath":\s*"([^"]*)""#
    let regex = try NSRegularExpression(pattern: pattern, options: [])
    let ns = text as NSString
    return regex.matches(in: text, range: NSRange(location: 0, length: ns.length)).map { match in
        Mission(
            id: ns.substring(with: match.range(at: 1)),
            date: ns.substring(with: match.range(at: 2)),
            squadron: ns.substring(with: match.range(at: 3)),
            sourceFront: ns.substring(with: match.range(at: 4)),
            scanFrontPath: ns.substring(with: match.range(at: 5))
        )
    }
}

func ocrText(for imageURL: URL) throws -> String {
    guard let source = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw NSError(domain: "audit", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not load image \(imageURL.path)"])
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.recognitionLanguages = ["en-US"]

    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try handler.perform([request])

    let observations = request.results ?? []
    let strings = observations.compactMap { $0.topCandidates(1).first?.string }
    return strings.joined(separator: "\n")
}

func extractDate(from text: String) -> String? {
    let normalized = text
        .replacingOccurrences(of: ",", with: "")
        .replacingOccurrences(of: ".", with: "")
        .lowercased()

    let monthMap = [
        "jan": "01", "january": "01",
        "feb": "02", "february": "02",
        "mar": "03", "march": "03",
        "apr": "04", "april": "04",
        "may": "05",
        "jun": "06", "june": "06",
        "jul": "07", "july": "07",
        "aug": "08", "august": "08",
        "sep": "09", "sept": "09", "september": "09",
        "oct": "10", "october": "10",
        "nov": "11", "november": "11",
        "dec": "12", "december": "12"
    ]

    let patterns = [
        #"(19\d{2})\s+([a-z]+)\s+(\d{1,2})"#,
        #"(\d{1,2})\s+([a-z]+)\s+(19\d{2}|\d{2})"#,
        #"([a-z]+)\s+(\d{1,2})\s+(19\d{2}|\d{2})"#
    ]

    for pattern in patterns {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { continue }
        let ns = normalized as NSString
        guard let match = regex.firstMatch(in: normalized, range: NSRange(location: 0, length: ns.length)) else { continue }
        let g1 = ns.substring(with: match.range(at: 1))
        let g2 = ns.substring(with: match.range(at: 2))
        let g3 = ns.substring(with: match.range(at: 3))

        var year = ""
        var month = ""
        var day = ""

        if g1.hasPrefix("19") {
            year = g1
            month = monthMap[g2] ?? ""
            day = g3
        } else if let mapped = monthMap[g2] {
            day = g1
            month = mapped
            year = g3.count == 2 ? "19\(g3)" : g3
        } else if let mapped = monthMap[g1] {
            month = mapped
            day = g2
            year = g3.count == 2 ? "19\(g3)" : g3
        }

        if !year.isEmpty && !month.isEmpty && !day.isEmpty {
            return "\(year)-\(month)-\(String(format: "%02d", Int(day) ?? 0))"
        }
    }
    return nil
}

func extractSquadron(from text: String) -> String? {
    let lower = text.lowercased()
    if lower.contains("434th") || lower.contains("484th") || lower.contains("434") || lower.contains("484") { return "434" }
    if lower.contains("83rd") || lower.contains("83rd sq") || lower.contains("83rd bomb") || lower.contains("83rd") { return "83" }
    if lower.contains("82nd") || lower.contains("82nd sq") || lower.contains("82nd") { return "82" }
    if lower.contains("81st") || lower.contains("81st sq") || lower.contains("81st") { return "81" }
    return nil
}

let root = FileManager.default.currentDirectoryPath
let dataPath = root + "/data/indiaburma1944-12th-bombardment-group-sortie-player-data.js"
let missions = try loadMissions(from: dataPath)

var results: [OCRResult] = []
for mission in missions {
    let url = URL(fileURLWithPath: root).appendingPathComponent("Oct1944").appendingPathComponent(mission.scanFrontPath.replacingOccurrences(of: "./", with: ""))
    let text = (try? ocrText(for: url)) ?? ""
    let normalized = text.replacingOccurrences(of: "\n", with: " ")
    let extractedDate = extractDate(from: text)
    let extractedSquadron = extractSquadron(from: text)
    let expectedDate = dateFromMissionID(mission.id)
    let expectedSquadron = squadronFromMissionID(mission.id)
    results.append(
        OCRResult(
            id: mission.id,
            date: mission.date,
            squadron: mission.squadron,
            sourceFront: mission.sourceFront,
            scanFrontPath: mission.scanFrontPath,
            recognizedText: text,
            normalizedText: normalized,
            extractedDate: extractedDate,
            extractedSquadron: extractedSquadron,
            dateMatchesId: extractedDate == nil || expectedDate == nil ? true : extractedDate == expectedDate,
            squadronMatchesId: extractedSquadron == nil || expectedSquadron == nil ? true : extractedSquadron == expectedSquadron
        )
    )
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
let output = try encoder.encode(results)
FileHandle.standardOutput.write(output)
