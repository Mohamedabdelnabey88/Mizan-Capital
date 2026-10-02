CREATE TRIGGER journals_no_update BEFORE UPDATE ON journals BEGIN SELECT RAISE(ABORT,'posted_entry_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER journals_no_delete BEFORE DELETE ON journals BEGIN SELECT RAISE(ABORT,'posted_entry_immutable'); END;
