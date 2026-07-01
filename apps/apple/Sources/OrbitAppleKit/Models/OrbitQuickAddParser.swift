import Foundation

public struct OrbitParsedQuickAdd: Sendable, Equatable {
    public var title: String
    public var bucket: OrbitBucket
    public var priority: Int
    public var dueText: String
    public var dueAt: Date?
    public var reminderAt: Date?

    public init(
        title: String,
        bucket: OrbitBucket = .inbox,
        priority: Int = 3,
        dueText: String = "",
        dueAt: Date? = nil,
        reminderAt: Date? = nil
    ) {
        self.title = title
        self.bucket = bucket
        self.priority = priority
        self.dueText = dueText
        self.dueAt = dueAt
        self.reminderAt = reminderAt
    }
}

public enum OrbitQuickAddParser {
    public static func parse(_ input: String, now: Date = Date(), calendar: Calendar = .current) -> OrbitParsedQuickAdd {
        var parts = input
            .split(whereSeparator: \.isWhitespace)
            .map(String.init)

        var bucket = OrbitBucket.inbox
        var priority = 3
        var dueText = ""
        var dueAt: Date?

        parts.removeAll { token in
            let normalized = normalize(token)

            if let parsedBucket = bucketToken(normalized) {
                bucket = parsedBucket
                return true
            }

            if let parsedPriority = priorityToken(normalized) {
                priority = parsedPriority
                return true
            }

            if let parsedDue = dueToken(normalized, now: now, calendar: calendar) {
                dueText = parsedDue.text
                dueAt = parsedDue.date
                return true
            }

            return false
        }

        let title = parts.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
        return OrbitParsedQuickAdd(
            title: title,
            bucket: bucket,
            priority: priority,
            dueText: dueText,
            dueAt: dueAt,
            reminderAt: reminderDate(for: dueAt, calendar: calendar)
        )
    }

    private static func normalize(_ token: String) -> String {
        token
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: ".,;:"))
            .lowercased()
    }

    private static func bucketToken(_ token: String) -> OrbitBucket? {
        switch token {
        case "#idag", "#today":
            .today
        case "#sen", "#later":
            .later
        case "#someday", "#någon-gång", "#nagon-gang", "#nångång", "#nan-gang":
            .someday
        case "#inbox", "#inkorg":
            .inbox
        default:
            nil
        }
    }

    private static func priorityToken(_ token: String) -> Int? {
        switch token {
        case "p1", "prio1", "prio-1":
            1
        case "p2", "prio2", "prio-2":
            2
        case "p3", "prio3", "prio-3":
            3
        default:
            nil
        }
    }

    private static func dueToken(_ token: String, now: Date, calendar: Calendar) -> (text: String, date: Date)? {
        let raw = token.hasPrefix("#") ? String(token.dropFirst()) : token
        switch raw {
        case "imorgon", "i-morgon":
            return ("imorgon", day(at: 9, adding: 1, from: now, calendar: calendar))
        case "ikväll", "ikvall":
            return ("ikväll", day(at: 18, adding: 0, from: now, calendar: calendar))
        case "nästa-vecka", "nasta-vecka":
            return ("nästa vecka", day(at: 9, adding: 7, from: now, calendar: calendar))
        case "nästa-månad", "nasta-manad":
            let base = day(at: 9, adding: 0, from: now, calendar: calendar)
            return ("nästa månad", calendar.date(byAdding: .month, value: 1, to: base) ?? base)
        case "mån", "man":
            return (raw, nextWeekday(2, from: now, calendar: calendar))
        case "tis":
            return (raw, nextWeekday(3, from: now, calendar: calendar))
        case "ons":
            return (raw, nextWeekday(4, from: now, calendar: calendar))
        case "tor":
            return (raw, nextWeekday(5, from: now, calendar: calendar))
        case "fre":
            return (raw, nextWeekday(6, from: now, calendar: calendar))
        case "lör", "lor":
            return (raw, nextWeekday(7, from: now, calendar: calendar))
        case "sön", "son":
            return (raw, nextWeekday(1, from: now, calendar: calendar))
        default:
            return relativeDue(raw, from: now, calendar: calendar)
        }
    }

    private static func relativeDue(_ raw: String, from now: Date, calendar: Calendar) -> (text: String, date: Date)? {
        guard raw.hasPrefix("om"), raw.count >= 4 else { return nil }
        let amountText = raw.dropFirst(2).dropLast()
        guard let amount = Int(amountText), let unit = raw.last else { return nil }
        let base = day(at: 9, adding: 0, from: now, calendar: calendar)
        switch unit {
        case "d":
            return ("om \(amount) dagar", calendar.date(byAdding: .day, value: amount, to: base) ?? base)
        case "v":
            return ("om \(amount) veckor", calendar.date(byAdding: .day, value: amount * 7, to: base) ?? base)
        case "m":
            return ("om \(amount) månader", calendar.date(byAdding: .month, value: amount, to: base) ?? base)
        default:
            return nil
        }
    }

    private static func nextWeekday(_ weekday: Int, from now: Date, calendar: Calendar) -> Date {
        let current = calendar.component(.weekday, from: now)
        let delta = (weekday - current + 7) % 7
        return day(at: 9, adding: delta == 0 ? 7 : delta, from: now, calendar: calendar)
    }

    private static func day(at hour: Int, adding days: Int, from now: Date, calendar: Calendar) -> Date {
        let start = calendar.startOfDay(for: now)
        let shifted = calendar.date(byAdding: .day, value: days, to: start) ?? start
        return calendar.date(bySettingHour: hour, minute: 0, second: 0, of: shifted) ?? shifted
    }

    private static func reminderDate(for dueAt: Date?, calendar: Calendar) -> Date? {
        guard let dueAt else { return nil }
        return calendar.date(byAdding: .hour, value: -1, to: dueAt)
    }
}
