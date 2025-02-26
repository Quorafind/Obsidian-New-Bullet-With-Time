import {
	addIcon,
	App,
	ButtonComponent,
	Editor,
	Plugin,
	PluginSettingTab,
	setIcon,
	Setting,
} from "obsidian";
import { EditorView, keymap } from "@codemirror/view";
import {
	Annotation,
	EditorState,
	Prec,
	Transaction,
	TransactionSpec,
} from "@codemirror/state";
import { moment } from "obsidian";

// Remember to rename these classes and interfaces!

interface NewBulletWithTimePluginSettings {
	timeFormat: string;
	timePrefixFormat: string;
	timeSuffixFormat: string;
	regexForTime: string;
	timeZone: string;
}

const DEFAULT_SETTINGS: NewBulletWithTimePluginSettings = {
	timeFormat: "HH:mm",
	timePrefixFormat: "",
	timeSuffixFormat: "",
	regexForTime: "\\d{2}:\\d{2}",
	timeZone: "local",
};

// Timezone map with common timezones and their UTC offsets
const TIMEZONE_MAP: Record<string, string> = {
	local: "Local Time",
	UTC: "UTC+0",
	"Africa/Abidjan": "UTC+0",
	"Africa/Accra": "UTC+0",
	"Africa/Algiers": "UTC+1",
	"Africa/Cairo": "UTC+2",
	"Africa/Casablanca": "UTC+1",
	"Africa/Johannesburg": "UTC+2",
	"Africa/Lagos": "UTC+1",
	"Africa/Nairobi": "UTC+3",
	"Africa/Tunis": "UTC+1",
	"America/Anchorage": "UTC-9",
	"America/Bogota": "UTC-5",
	"America/Buenos_Aires": "UTC-3",
	"America/Caracas": "UTC-4",
	"America/Chicago": "UTC-6",
	"America/Denver": "UTC-7",
	"America/Halifax": "UTC-4",
	"America/Los_Angeles": "UTC-8",
	"America/Mexico_City": "UTC-6",
	"America/New_York": "UTC-5",
	"America/Phoenix": "UTC-7",
	"America/Santiago": "UTC-4",
	"America/Sao_Paulo": "UTC-3",
	"America/Toronto": "UTC-5",
	"America/Vancouver": "UTC-8",
	"Asia/Baghdad": "UTC+3",
	"Asia/Bangkok": "UTC+7",
	"Asia/Dhaka": "UTC+6",
	"Asia/Dubai": "UTC+4",
	"Asia/Hong_Kong": "UTC+8",
	"Asia/Jakarta": "UTC+7",
	"Asia/Jerusalem": "UTC+2",
	"Asia/Karachi": "UTC+5",
	"Asia/Kolkata": "UTC+5:30",
	"Asia/Kuwait": "UTC+3",
	"Asia/Manila": "UTC+8",
	"Asia/Riyadh": "UTC+3",
	"Asia/Seoul": "UTC+9",
	"Asia/Shanghai": "UTC+8",
	"Asia/Singapore": "UTC+8",
	"Asia/Taipei": "UTC+8",
	"Asia/Tehran": "UTC+3:30",
	"Asia/Tokyo": "UTC+9",
	"Australia/Adelaide": "UTC+9:30",
	"Australia/Brisbane": "UTC+10",
	"Australia/Melbourne": "UTC+10",
	"Australia/Perth": "UTC+8",
	"Australia/Sydney": "UTC+10",
	"Europe/Amsterdam": "UTC+1",
	"Europe/Athens": "UTC+2",
	"Europe/Berlin": "UTC+1",
	"Europe/Brussels": "UTC+1",
	"Europe/Budapest": "UTC+1",
	"Europe/Copenhagen": "UTC+1",
	"Europe/Dublin": "UTC+0",
	"Europe/Helsinki": "UTC+2",
	"Europe/Istanbul": "UTC+3",
	"Europe/Lisbon": "UTC+0",
	"Europe/London": "UTC+0",
	"Europe/Madrid": "UTC+1",
	"Europe/Moscow": "UTC+3",
	"Europe/Oslo": "UTC+1",
	"Europe/Paris": "UTC+1",
	"Europe/Prague": "UTC+1",
	"Europe/Rome": "UTC+1",
	"Europe/Stockholm": "UTC+1",
	"Europe/Vienna": "UTC+1",
	"Europe/Warsaw": "UTC+1",
	"Europe/Zurich": "UTC+1",
	"Pacific/Auckland": "UTC+12",
	"Pacific/Fiji": "UTC+12",
	"Pacific/Honolulu": "UTC-10",
	"Pacific/Midway": "UTC-11",
	"Pacific/Tahiti": "UTC-10",
};

export default class NewBulletWithTimePlugin extends Plugin {
	settings: NewBulletWithTimePluginSettings;

	async onload() {
		await this.loadSettings();

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new NewBulletWithTimeSettingTab(this.app, this));

		// Register transaction filter to handle Enter key events
		this.registerEditorExtension(
			EditorState.transactionFilter.of((tr) => this.handleTransaction(tr))
		);

		this.addCommand({
			id: "add-time-to-the-start",
			name: "Add time to the start",
			hotkeys: [],
			editorCallback: (editor) => {
				// @ts-expect-error, not typed
				const editorView = editor.cm as EditorView;

				this.addTime(editor, editorView, "Start");
			},
		});

		this.addCommand({
			id: "add-time-to-the-end",
			name: "Add time to the end",
			hotkeys: [],
			editorCallback: (editor, view) => {
				// @ts-expect-error, not typed
				const editorView = editor.cm as EditorView;

				this.addTime(editor, editorView, "End");
			},
		});
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	addTime(editor: Editor, view: EditorView, position: string) {
		const { state } = view;
		const { from } = state.selection.main;
		const line = state.doc.lineAt(from);
		const text = state.doc.sliceString(line.from, line.to);

		// Get formatted time string
		const timeString = this.getFormattedTimeString();

		// Create regex patterns for time detection
		const timePatterns = this.createTimePatterns();

		// Handle based on position
		if (position === "Start") {
			this.handleStartPosition(
				editor,
				line,
				text,
				timeString,
				timePatterns
			);
		} else if (position === "End") {
			this.handleEndPosition(
				editor,
				line,
				text,
				timeString,
				timePatterns
			);
		}
	}

	/**
	 * Get formatted time string with prefix and suffix
	 */
	private getFormattedTimeString(): string {
		const currentTime = this.getTimeWithTimezone();
		return (
			this.settings.timePrefixFormat +
			currentTime.format(this.settings.timeFormat) +
			this.settings.timeSuffixFormat
		);
	}

	/**
	 * Create regex patterns for time detection
	 */
	private createTimePatterns() {
		const prefixRegex = this.escapeRegExp(this.settings.timePrefixFormat);
		const suffixRegex = this.escapeRegExp(this.settings.timeSuffixFormat);

		return {
			// For detecting time anywhere in text
			timeRegex: new RegExp(
				prefixRegex + this.settings.regexForTime + suffixRegex
			),
			// For detecting time at the end of text
			endTimeRegex: new RegExp(
				prefixRegex + this.settings.regexForTime + suffixRegex + "\\s*$"
			),
			// For detecting bullets
			bulletRegex: new RegExp("^\\s*(([-*+]|\\d+\\.)(\\s\\[(.)\\])?\\s)"),
			// For detecting headings
			headingRegex: new RegExp("^#{1,6}\\s"),
		};
	}

	/**
	 * Handle adding/updating time at the start position
	 */
	private handleStartPosition(
		editor: Editor,
		line: { from: number; to: number },
		text: string,
		timeString: string,
		patterns: {
			timeRegex: RegExp;
			bulletRegex: RegExp;
			headingRegex: RegExp;
		}
	) {
		// Try to handle as bullet
		if (
			this.handleMarkdownElement(
				editor,
				line,
				text,
				timeString,
				patterns.bulletRegex,
				patterns.timeRegex
			)
		) {
			return;
		}

		// Try to handle as heading
		if (
			this.handleMarkdownElement(
				editor,
				line,
				text,
				timeString,
				patterns.headingRegex,
				patterns.timeRegex
			)
		) {
			return;
		}

		// Handle as plain text (no bullet or heading)
		this.handlePlainTextStart(
			editor,
			line,
			text,
			timeString,
			patterns.timeRegex
		);
	}

	/**
	 * Handle adding/updating time at markdown element (bullet or heading)
	 * Returns true if handled
	 */
	private handleMarkdownElement(
		editor: Editor,
		line: { from: number; to: number },
		text: string,
		timeString: string,
		elementRegex: RegExp,
		timeRegex: RegExp
	): boolean {
		if (!elementRegex.test(text)) {
			return false;
		}

		const matches = text.match(elementRegex);
		if (!matches) {
			return false;
		}

		const afterElementText = text.substring(matches[0].length);
		const timeMatch = afterElementText.match(timeRegex);
		const insertPosition = line.from + matches[0].length;

		if (timeMatch && timeMatch.index === 0) {
			// Update existing time
			this.updateExistingTime(
				editor,
				insertPosition,
				insertPosition + timeMatch[0].length,
				timeString
			);

			// Set cursor at end of line
			editor.setCursor(editor.offsetToPos(line.to));
		} else {
			// Add new time
			this.insertNewTime(
				editor,
				insertPosition,
				insertPosition,
				timeString + " "
			);

			// Set cursor after time
			editor.setCursor(
				editor.offsetToPos(insertPosition + timeString.length + 1)
			);
		}

		return true;
	}

	/**
	 * Handle adding/updating time at the start of plain text
	 */
	private handlePlainTextStart(
		editor: Editor,
		line: { from: number; to: number },
		text: string,
		timeString: string,
		timeRegex: RegExp
	) {
		const timeMatch = text.match(timeRegex);

		if (timeMatch && timeMatch.index === 0) {
			// Update existing time
			this.updateExistingTime(
				editor,
				line.from,
				line.from + timeMatch[0].length,
				timeString
			);
		} else {
			// Add new time
			this.insertNewTime(editor, line.from, line.from, timeString + " ");
		}

		// Set cursor after time
		editor.setCursor(editor.offsetToPos(line.from + timeString.length + 1));
	}

	/**
	 * Handle adding/updating time at the end position
	 */
	private handleEndPosition(
		editor: Editor,
		line: { from: number; to: number },
		text: string,
		timeString: string,
		patterns: { endTimeRegex: RegExp }
	) {
		const endTimeMatch = text.match(patterns.endTimeRegex);

		if (endTimeMatch) {
			// Update existing time at end
			const startPos = line.from + text.lastIndexOf(endTimeMatch[0]);
			this.updateExistingTime(editor, startPos, line.to, timeString);
		} else {
			// Add new time at end
			this.insertNewTime(editor, line.to, line.to, " " + timeString);
		}

		// Set cursor at end
		editor.setCursor(editor.offsetToPos(line.to + timeString.length));
	}

	/**
	 * Update existing time with new time string
	 */
	private updateExistingTime(
		editor: Editor,
		fromPos: number,
		toPos: number,
		timeString: string
	) {
		editor.transaction({
			changes: [
				{
					text: timeString,
					from: editor.offsetToPos(fromPos),
					to: editor.offsetToPos(toPos),
				},
			],
		});
	}

	/**
	 * Insert new time string
	 */
	private insertNewTime(
		editor: Editor,
		fromPos: number,
		toPos: number,
		timeString: string
	) {
		editor.transaction({
			changes: [
				{
					text: timeString,
					from: editor.offsetToPos(fromPos),
					to: editor.offsetToPos(toPos),
				},
			],
		});
	}

	/**
	 * Get current time with timezone consideration
	 */
	private getTimeWithTimezone() {
		// If using local time, return moment() without timezone
		if (this.settings.timeZone === "local") {
			return moment();
		}

		// For other timezones, we need to manually adjust the time
		// Get the current UTC time
		const now = moment().utc();

		// Parse the UTC offset from the timezone map
		const timezoneInfo = TIMEZONE_MAP[this.settings.timeZone] || "UTC+0";
		const offsetMatch = timezoneInfo.match(/UTC([+-])(\d+)(?::(\d+))?/);

		if (offsetMatch) {
			const sign = offsetMatch[1] === "+" ? 1 : -1;
			const hours = parseInt(offsetMatch[2], 10) * sign;
			const minutes = offsetMatch[3]
				? parseInt(offsetMatch[3], 10) * sign
				: 0;

			// Add the offset to the UTC time
			return now.add(hours, "hours").add(minutes, "minutes");
		}

		// Default to UTC if no match
		return now;
	}

	/**
	 * Handle transactions to detect Enter key presses and add time stamps
	 * This replaces the previous keydown event handler approach
	 */
	private readonly handleTransaction = (
		tr: Transaction
	): Transaction | TransactionSpec => {
		// Only process transactions that change the document and are user input events
		if (!tr.docChanged || !tr.isUserEvent("input.type")) {
			return tr;
		}

		// Check if this is an Enter key transaction (newline insertion)
		const isEnterKeyPress = this.isEnterKeyTransaction(tr);
		if (!isEnterKeyPress) {
			return tr;
		}

		// Handle blank bullet case (similar to handleKeydownBeforeNewLine)
		if (this.shouldSkipTimeInsertion(tr)) {
			return tr;
		}

		if (this.shouldRemoveTime(tr)) {
			return this.processTimeRemoval(tr) || tr;
		}

		// Handle time insertion for bullet with time (similar to handleKeydown)
		const timeSpec = this.processTimeInsertion(tr);
		return timeSpec || tr;
	};

	/**
	 * Determine if a transaction represents an Enter key press
	 */
	private isEnterKeyTransaction(tr: Transaction): boolean {
		// Check if the transaction inserts a newline character
		let hasNewline = false;

		tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
			if (inserted.toString().includes("\n")) {
				hasNewline = true;
			}
		});
		return hasNewline;
	}

	/**
	 * Check if we should skip time insertion (blank bullet case or non-bullet line)
	 */
	private shouldSkipTimeInsertion(tr: Transaction): boolean {
		// Find the line before the cursor after the transaction
		const pos = tr.startState.selection.main.to || 0;
		const { state } = tr;
		const prevLineNumber = state.doc.lineAt(pos).number;

		if (prevLineNumber <= 0) return false;

		const prevLine = state.doc.line(prevLineNumber);
		const prevLineText = prevLine.text;

		// Check if previous line is a bullet
		const bulletRegex = new RegExp("^\\s*([-*+]|\\d+\\.)");

		// If it's not a bullet line at all, skip time insertion
		if (!bulletRegex.test(prevLineText)) return true;

		// Check if previous line is a blank bullet
		const blankBulletRegex = new RegExp(
			"([-*+]|\\d+\\.)(\\s\\[(.)\\])?\\s*$"
		);
		return blankBulletRegex.test(prevLineText);
	}

	/**
	 * Check if we should remove time from the line
	 */
	private shouldRemoveTime(tr: Transaction): boolean {
		const pos = tr.state.selection.main.to || 0;
		const { state } = tr;
		const currentLine = state.doc.lineAt(pos);

		if (currentLine.number <= 1) return false;

		const prevLineNumber = currentLine.number - 1;
		const prevLine = state.doc.line(prevLineNumber);
		const prevLineText = prevLine.text;

		const prefixRegex = this.escapeRegExp(this.settings.timePrefixFormat);
		const suffixRegex = this.escapeRegExp(this.settings.timeSuffixFormat);

		// Check if the line only contains a bullet and timestamp
		const bulletWithTimeRegex = new RegExp(
			"^\\s*([-*+]|\\d+\\.)(\\s\\[(.)\\])?\\s+" +
				prefixRegex +
				this.settings.regexForTime +
				suffixRegex +
				"\\s*$"
		);

		return bulletWithTimeRegex.test(prevLineText);
	}

	/**
	 * Process time insertion for a bullet with time
	 */
	private processTimeInsertion(tr: Transaction): TransactionSpec | null {
		const pos = tr.state.selection.main.to || 0;
		const startPos = tr.startState.selection.main.to || 0;
		const { state } = tr;
		const currentLine = state.doc.lineAt(pos);

		// If we're at the first line, there's no previous line to check
		if (currentLine.number <= 1) return null;

		const prevLineNumber = currentLine.number - 1;
		const prevLine = state.doc.line(prevLineNumber);
		const prevLineText = prevLine.text;

		const prefixRegex = this.escapeRegExp(this.settings.timePrefixFormat);
		const suffixRegex = this.escapeRegExp(this.settings.timeSuffixFormat);

		// Check if previous line has a time format
		const timeRegex = new RegExp(
			"([-*+]|\\d+\\.)(\\s\\[(.)\\])?\\s" +
				prefixRegex +
				this.settings.regexForTime +
				suffixRegex
		);
		if (!timeRegex.test(prevLineText)) return null;

		// Get current time with timezone consideration
		const currentTime = this.getTimeWithTimezone();

		// Generate time string to insert
		const timeString =
			this.settings.timePrefixFormat +
			currentTime.format(this.settings.timeFormat) +
			this.settings.timeSuffixFormat +
			" ";

		return {
			changes: [
				tr.changes,
				{
					from: startPos,
					to: startPos,
					insert: timeString,
				},
			],
			selection: {
				anchor: currentLine.to + timeString.length,
			},
		} as TransactionSpec;
	}

	/**
	 * Process time removal for a bullet with time
	 */
	private processTimeRemoval(tr: Transaction): TransactionSpec | null {
		const pos = tr.state.selection.main.to || 0;
		const { state } = tr;
		const currentLine = state.doc.lineAt(pos);

		if (currentLine.number <= 0) return null;

		const prevLineNumber = currentLine.number - 1;
		const prevLine = state.doc.line(prevLineNumber);
		const prevLineText = prevLine.text;

		const prefixRegex = this.escapeRegExp(this.settings.timePrefixFormat);
		const suffixRegex = this.escapeRegExp(this.settings.timeSuffixFormat);

		// Find the time pattern in the previous line
		const timePattern = new RegExp(
			prefixRegex + this.settings.regexForTime + suffixRegex + "\\s*"
		);

		const match = prevLineText.match(timePattern);
		if (!match) return null;

		// Calculate positions for removal
		const timeStartPos = prevLine.from + prevLineText.indexOf(match[0]);
		const timeEndPos = timeStartPos + match[0].length;

		return {
			changes: {
				from: timeStartPos,
				to: timeEndPos,
				insert: "",
			},
			selection: {
				anchor: timeStartPos,
			},
		} as TransactionSpec;
	}

	escapeRegExp(text: string): string {
		//eslint-disable-next-line
		return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
	}

	registerIconList() {
		addIcon(
			"alipay",
			`<svg t="1668133260947" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="3767" width="100" height="100" fill="currentColor"><path d="M492.343 777.511c-67.093 32.018-144.129 51.939-227.552 32.27-83.424-19.678-142.626-73.023-132.453-171.512 10.192-98.496 115.478-132.461 202.07-132.461 86.622 0 250.938 56.122 250.938 56.122s13.807-30.937 27.222-66.307c13.405-35.365 17.21-63.785 17.21-63.785H279.869v-35.067h169.995v-67.087l-211.925 1.526v-44.218h211.925v-100.63h111.304v100.629H788.35v44.218l-227.181 1.524v62.511l187.584 1.526s-3.391 35.067-27.17 98.852c-23.755 63.783-46.061 96.312-46.061 96.312L960 685.279V243.2C960 144.231 879.769 64 780.8 64H243.2C144.231 64 64 144.231 64 243.2v537.6C64 879.769 144.231 960 243.2 960h537.6c82.487 0 151.773-55.806 172.624-131.668L625.21 672.744s-65.782 72.748-132.867 104.767z" p-id="3768"></path><path d="M297.978 559.871c-104.456 6.649-129.974 52.605-129.974 94.891s25.792 101.073 148.548 101.073c122.727 0 226.909-123.77 226.909-123.77s-141.057-78.842-245.483-72.194z" p-id="3769"></path></svg>`
		);
		addIcon(
			"wechat",
			`<svg t="1668133215423" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="2768" width="100" height="100" fill="currentColor"><path d="M857.6 0H165.888C74.24 0 0 74.24 0 166.4v691.2c0 92.16 74.24 166.4 165.888 166.4h692.224c91.648 0 165.888-74.24 165.888-166.4v-691.2c-0.512-92.16-74.752-166.4-166.4-166.4zM384 686.08c-38.4 0-69.632-7.68-108.544-15.872l-108.544 54.272 31.232-93.184c-77.824-54.272-123.904-123.904-123.904-209.92 0-147.968 139.776-264.192 310.784-264.192 152.576 0 286.208 93.184 312.832 218.112-10.24-1.024-19.456-1.536-30.208-1.536-147.456 0-264.192 110.08-264.192 245.76 0 22.528 3.584 44.544 9.728 65.024-9.728 1.024-19.456 1.536-29.184 1.536z m457.728 108.544l23.04 77.824-84.992-46.592c-31.232 7.68-62.464 15.872-93.184 15.872-147.968 0-264.192-100.864-264.192-225.28 0-123.904 116.224-225.28 264.192-225.28 139.776 0 263.68 101.376 263.68 225.28 0.512 69.632-46.08 131.584-108.544 178.176z" p-id="2769"></path><path d="M237.568 323.072c0 12.288 5.12 24.064 13.312 32.768 8.704 8.704 20.48 13.312 32.768 13.312 12.288 0 24.064-5.12 32.768-13.312 8.704-8.704 13.312-20.992 13.312-32.768 0-12.288-5.12-24.064-13.312-32.768-8.704-8.704-20.992-13.312-32.768-13.312-12.288 0-24.064 5.12-32.768 13.312-8.704 8.704-13.312 20.992-13.312 32.768zM462.336 323.072c0 12.288 5.12 24.064 13.312 32.768s20.992 13.312 32.768 13.312c12.288 0 24.064-5.12 32.768-13.312 8.704-8.704 13.312-20.992 13.312-32.768 0-12.288-5.12-24.064-13.312-32.768-8.704-8.704-20.992-13.312-32.768-13.312-12.288 0-24.064 5.12-32.768 13.312-8.192 8.704-13.312 20.992-13.312 32.768zM574.464 547.328c0 9.216 3.584 18.432 10.752 25.088 6.656 6.144 15.872 10.24 25.088 10.24s18.432-3.584 25.088-10.24c6.656-6.144 10.752-15.872 10.752-25.088s-3.584-18.432-10.752-25.088c-6.656-6.144-15.872-10.24-25.088-10.24s-18.432 3.584-25.088 10.24c-6.656 6.656-10.752 15.872-10.752 25.088zM737.28 547.328c0 9.216 3.584 18.432 10.752 25.088 6.656 6.144 15.872 10.24 25.088 10.24s18.432-3.584 25.088-10.24c6.656-6.144 10.752-15.872 10.752-25.088s-3.584-18.432-10.752-25.088c-6.656-6.144-15.872-10.24-25.088-10.24s-18.432 3.584-25.088 10.24c-6.656 6.656-10.752 15.872-10.752 25.088z" p-id="2770"></path></svg>`
		);
	}
}

class NewBulletWithTimeSettingTab extends PluginSettingTab {
	plugin: NewBulletWithTimePlugin;
	private applyDebounceTimer: number = 0;

	constructor(app: App, plugin: NewBulletWithTimePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	applySettingsUpdate() {
		clearTimeout(this.applyDebounceTimer);
		const plugin = this.plugin;
		this.applyDebounceTimer = window.setTimeout(() => {
			plugin.saveSettings();
		}, 100);
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Time format")
			.setDesc(
				"Use time format like HH:mm to insert into newly created bullet item."
			)
			.addText((text) =>
				text
					.setPlaceholder("Set your time format")
					.setValue(this.plugin.settings.timeFormat)
					.onChange(async (value) => {
						this.plugin.settings.timeFormat = value;
						this.applySettingsUpdate();
					})
			);

		new Setting(containerEl)
			.setName("Prefix")
			.setDesc(
				"When insert time to bullet, this prefix would be added automatically."
			)
			.addText((text) =>
				text
					.setPlaceholder("Set your prefix")
					.setValue(this.plugin.settings.timePrefixFormat)
					.onChange(async (value) => {
						this.plugin.settings.timePrefixFormat = value;
						this.applySettingsUpdate();
					})
			);

		new Setting(containerEl)
			.setName("Suffix")
			.setDesc(
				"When insert time to bullet, suffix would be added automatically."
			)
			.addText((text) =>
				text
					.setPlaceholder("Set your suffix")
					.setValue(this.plugin.settings.timeSuffixFormat)
					.onChange(async (value) => {
						this.plugin.settings.timeSuffixFormat = value;
						this.applySettingsUpdate();
					})
			);

		new Setting(containerEl)
			.setName("Regex for Time format")
			.setDesc(
				"When you do not use HH:mm , you should change the regex here to make plugin works correctly."
			)
			.addText((text) =>
				text
					.setPlaceholder("Set your regex for time format")
					.setValue(this.plugin.settings.regexForTime)
					.onChange(async (value) => {
						this.plugin.settings.regexForTime = value;
						this.applySettingsUpdate();
					})
			);

		new Setting(containerEl)
			.setName("Time zone")
			.setDesc("Set your time zone. Default is your local time.")
			.addDropdown((dropdown) => {
				// Add all timezones from the TIMEZONE_MAP
				Object.keys(TIMEZONE_MAP).forEach((timezone) => {
					dropdown.addOption(
						timezone,
						`${timezone} (${TIMEZONE_MAP[timezone]})`
					);
				});

				// Set the current value
				dropdown.setValue(this.plugin.settings.timeZone);

				dropdown.onChange(async (value) => {
					this.plugin.settings.timeZone = value;
					this.applySettingsUpdate();
				});
			});
		new Setting(containerEl)
			.setName("Donate")
			.setDesc(
				"If you like this plugin, consider donating to support continued development:"
			)
			.addButton((bt) => {
				this.addImageToButton(
					bt,
					"https://cdn.jsdelivr.net/gh/Quorafind/.github@main/IMAGE/%E5%BE%AE%E4%BF%A1%E4%BB%98%E6%AC%BE%E7%A0%81.jpg",
					"wechat"
				);
			})
			.addButton((bt) => {
				this.addImageToButton(
					bt,
					"https://cdn.jsdelivr.net/gh/Quorafind/.github@main/IMAGE/%E6%94%AF%E4%BB%98%E5%AE%9D%E4%BB%98%E6%AC%BE%E7%A0%81.jpg",
					"alipay"
				);
			})
			.addButton((bt) => {
				this.addImageToButton(
					bt,
					"https://www.buymeacoffee.com/Quorafind",
					"bmc",
					"https://img.buymeacoffee.com/button-api/?text=Coffee&emoji=&slug=boninall&button_colour=886ce4&font_colour=ffffff&font_family=Comic&outline_colour=000000&coffee_colour=FFDD00"
				);
			});
	}

	addImageToButton(
		button: ButtonComponent,
		url: string,
		imageType: string,
		imageUrl?: string
	): void {
		const aTagEL = button.buttonEl.createEl("a", {
			href: url,
		});
		button.buttonEl.addClass("dbl-donate-button");

		switch (imageType) {
			case "alipay":
				setIcon(aTagEL, "alipay");
				break;
			case "wechat":
				setIcon(aTagEL, "wechat");
				break;
			case "bmc":
				const favicon = document.createElement(
					"img"
				) as HTMLImageElement;
				if (imageUrl) favicon.src = imageUrl;
				aTagEL.appendChild(favicon);
				break;
			default:
				break;
		}
	}
}
