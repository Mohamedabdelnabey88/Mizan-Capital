-- Database-level guards for append-only accounting and valid JSON records.
-- All monetary values are integer halalas; reject coercion of decimals or strings.
CREATE TRIGGER IF NOT EXISTS journals_no_update BEFORE UPDATE ON journals BEGIN SELECT RAISE(ABORT,'posted_entry_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS journals_no_delete BEFORE DELETE ON journals BEGIN SELECT RAISE(ABORT,'posted_entry_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS journals_lines_shape BEFORE INSERT ON journals
WHEN CASE WHEN json_valid(NEW.lines) THEN (json_type(NEW.lines) IS NOT 'array' OR json_array_length(NEW.lines)<2 OR json_array_length(NEW.lines)>100) ELSE 1 END
BEGIN SELECT RAISE(ABORT,'journal_lines_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS journals_lines_values BEFORE INSERT ON journals
WHEN json_valid(NEW.lines) AND EXISTS (
  SELECT 1 FROM json_each(NEW.lines)
  WHERE json_type(value) IS NOT 'object'
     OR json_type(value,'$.project') IS NOT 'text'
     OR json_type(value,'$.account') IS NOT 'text'
     OR length(trim(json_extract(value,'$.account'))) = 0
     OR json_type(value,'$.debit') IS NOT 'integer'
     OR json_type(value,'$.credit') IS NOT 'integer'
     OR CAST(json_extract(value,'$.debit') AS INTEGER) < 0
     OR CAST(json_extract(value,'$.credit') AS INTEGER) < 0
     OR (CAST(json_extract(value,'$.debit') AS INTEGER) > 0 AND CAST(json_extract(value,'$.credit') AS INTEGER) > 0)
     OR (CAST(json_extract(value,'$.debit') AS INTEGER) = 0 AND CAST(json_extract(value,'$.credit') AS INTEGER) = 0)
)
BEGIN SELECT RAISE(ABORT,'journal_line_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS journals_balanced BEFORE INSERT ON journals
WHEN json_valid(NEW.lines)
 AND (SELECT COALESCE(SUM(CAST(json_extract(value,'$.debit') AS INTEGER)),0) FROM json_each(NEW.lines))
     <> (SELECT COALESCE(SUM(CAST(json_extract(value,'$.credit') AS INTEGER)),0) FROM json_each(NEW.lines))
BEGIN SELECT RAISE(ABORT,'journal_unbalanced'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS records_valid_insert BEFORE INSERT ON records
WHEN NOT json_valid(NEW.data) OR length(trim(NEW.kind))=0 OR length(trim(NEW.owner))=0
BEGIN SELECT RAISE(ABORT,'record_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS records_valid_update BEFORE UPDATE ON records
WHEN NOT json_valid(NEW.data) OR length(trim(NEW.kind))=0 OR length(trim(NEW.owner))=0
BEGIN SELECT RAISE(ABORT,'record_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'audit_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'audit_immutable'); END;
