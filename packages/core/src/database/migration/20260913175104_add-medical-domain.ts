import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260913175104_add-medical-domain",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`audit_log\` (
          \`id\` text PRIMARY KEY,
          \`episode_id\` text NOT NULL,
          \`node_id\` text,
          \`actor\` text NOT NULL,
          \`action\` text NOT NULL,
          \`target\` text,
          \`detail\` text,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_audit_log_episode_id_episode_id_fk\` FOREIGN KEY (\`episode_id\`) REFERENCES \`episode\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`clinical_data\` (
          \`id\` text PRIMARY KEY,
          \`episode_id\` text NOT NULL,
          \`node_id\` text,
          \`kind\` text NOT NULL,
          \`label\` text DEFAULT '' NOT NULL,
          \`collected_at\` integer NOT NULL,
          \`source\` text,
          \`version\` text,
          \`status\` text DEFAULT 'captured' NOT NULL,
          \`is_negative\` integer DEFAULT false NOT NULL,
          \`payload\` text,
          \`payload_previous\` text,
          \`changed\` integer DEFAULT false NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_clinical_data_episode_id_episode_id_fk\` FOREIGN KEY (\`episode_id\`) REFERENCES \`episode\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`episode_node\` (
          \`id\` text PRIMARY KEY,
          \`episode_id\` text NOT NULL,
          \`node_key\` text NOT NULL,
          \`seq\` integer NOT NULL,
          \`status\` text NOT NULL,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`missing\` text NOT NULL,
          \`unavailable\` text NOT NULL,
          \`output_agent\` text,
          \`output_final\` text,
          \`output_diff\` text,
          \`edited_by\` text,
          \`confirmed_by\` text,
          \`confirmed_at\` integer,
          \`reject_reason\` text,
          \`stale\` integer DEFAULT false NOT NULL,
          \`time_started\` integer,
          \`time_ended\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_episode_node_episode_id_episode_id_fk\` FOREIGN KEY (\`episode_id\`) REFERENCES \`episode\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`episode\` (
          \`id\` text PRIMARY KEY,
          \`patient_id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`title\` text DEFAULT '' NOT NULL,
          \`status\` text DEFAULT 'active' NOT NULL,
          \`current_node\` text,
          \`time_opened\` integer NOT NULL,
          \`time_closed\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_episode_patient_id_patient_id_fk\` FOREIGN KEY (\`patient_id\`) REFERENCES \`patient\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_episode_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`med_calc_log\` (
          \`id\` text PRIMARY KEY,
          \`episode_id\` text NOT NULL,
          \`node_id\` text,
          \`calc\` text NOT NULL,
          \`input\` text,
          \`output\` text,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_med_calc_log_episode_id_episode_id_fk\` FOREIGN KEY (\`episode_id\`) REFERENCES \`episode\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`node_revision\` (
          \`id\` text PRIMARY KEY,
          \`node_id\` text NOT NULL,
          \`revision\` integer NOT NULL,
          \`output\` text,
          \`actor\` text NOT NULL,
          \`action\` text NOT NULL,
          \`reason\` text,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_node_revision_node_id_episode_node_id_fk\` FOREIGN KEY (\`node_id\`) REFERENCES \`episode_node\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`patient\` (
          \`id\` text PRIMARY KEY,
          \`name\` text NOT NULL,
          \`sex\` text,
          \`birth_date\` text,
          \`weight_kg\` real,
          \`height_cm\` real,
          \`allergies\` text NOT NULL,
          \`comorbidities\` text NOT NULL,
          \`baseline\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`CREATE INDEX \`audit_log_episode_time_idx\` ON \`audit_log\` (\`episode_id\`,\`time_created\`);`)
      yield* tx.run(`CREATE INDEX \`clinical_data_episode_kind_idx\` ON \`clinical_data\` (\`episode_id\`,\`kind\`);`)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`episode_node_episode_key_idx\` ON \`episode_node\` (\`episode_id\`,\`node_key\`);`,
      )
      yield* tx.run(`CREATE INDEX \`episode_node_episode_seq_idx\` ON \`episode_node\` (\`episode_id\`,\`seq\`);`)
      yield* tx.run(`CREATE UNIQUE INDEX \`episode_session_idx\` ON \`episode\` (\`session_id\`);`)
      yield* tx.run(`CREATE INDEX \`episode_patient_idx\` ON \`episode\` (\`patient_id\`);`)
      yield* tx.run(`CREATE INDEX \`node_revision_node_idx\` ON \`node_revision\` (\`node_id\`,\`revision\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
