/**
 * Database types for the BizBook Supabase migrations.
 *
 * Source of truth: supabase/migrations/*.sql. Keep these types in sync when a migration changes.
 * The typed browser, user-session, and server-admin clients are defined separately in lib/supabase.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Relationship<
  Name extends string,
  Columns extends string[],
  ReferencedRelation extends string,
  ReferencedColumns extends string[],
  IsOneToOne extends boolean = false,
> = {
  foreignKeyName: Name;
  columns: Columns;
  isOneToOne: IsOneToOne;
  referencedRelation: ReferencedRelation;
  referencedColumns: ReferencedColumns;
};

type Table<
  Row,
  Required extends keyof Row,
  Relationships extends Relationship<string, string[], string, string[]>[] = [],
> = {
  Row: Row;
  Insert: Pick<Row, Required> & Partial<Omit<Row, Required>>;
  Update: Partial<Row>;
  Relationships: Relationships;
};

type View<Row> = { Row: Row; Relationships: [] };

export type PaymentMethod =
  | "Cash"
  | "UPI"
  | "Bank Transfer"
  | "Card"
  | "Cheque"
  | "Online"
  | "Other";
export type PaymentStatus =
  | "Pending"
  | "Processing"
  | "Paid"
  | "Failed"
  | "Cancelled"
  | "Refunded"
  | "Partially Refunded";
export type RefundStatus = "Pending" | "Processing" | "Completed" | "Failed" | "Cancelled";
export type SalaryCalculationMode = "AttendanceBased" | "Fixed";

export type Database = {
  public: {
    Tables: {
      platform_administrators: Table<
        { user_id: string; role: "owner" | "operator" | "support"; granted_by: string | null; created_at: string },
        "user_id"
      >;
      platform_provider_connections: Table<
        {
          id: string; provider_scope: "payment" | "email" | "whatsapp"; provider: string;
          account_reference: string | null; secret_reference: string | null; environment: "test";
          connection_status: "inactive" | "pending" | "active" | "disabled";
          last_verified_at: string | null; updated_by: string | null;
          receipt_delivery_enabled: boolean;
          created_at: string; updated_at: string;
        },
        "provider_scope" | "provider"
      >;
      platform_reminder_policy: Table<
        { id: boolean; is_enabled: boolean; schedule: Json; updated_by: string | null; updated_at: string },
        "id" | "schedule"
      >;
      platform_subscription_reminder_policy: Table<
        { id: boolean; is_enabled: boolean; schedule: Json; schedule_version: number; updated_by: string | null; updated_at: string },
        "id" | "schedule"
      >;
      platform_fee_receipt_policy: Table<
        {
          id: boolean; delivery_channels: Json; template_title: string; accent_color: string; header_color: string; footer_note: string;
          show_installment_schedule: boolean; show_payment_reference: boolean; show_institute_logo: boolean;
          show_bizbook_brand_mark: boolean; bizbook_brand_name: string; terms_note: string;
          show_watermark: boolean; watermark_size_percent: number; watermark_opacity_percent: number;
          title_bold: boolean; title_pill: boolean; show_paid_seal: boolean; paid_seal_color: string; paid_seal_opacity_percent: number;
          paid_seal_size_percent: number;
          watermark_logo_path: string | null;
          updated_by: string | null; updated_at: string;
        },
        "id"
      >;
      platform_subscription_reminder_logs: Table<
        {
          id: string; institute_id: string; subscription_id: string; reminder_period_end: string;
          reminder_number: number; schedule_version: number; channel: "Email" | "WhatsApp";
          delivery_status: "Processing" | "Sent" | "Failed" | "Unknown" | "Skipped";
          provider: string | null; provider_message_reference: string | null; recipient_fingerprint: string | null;
          idempotency_key: string; attempt_count: number; retryable: boolean; next_attempt_at: string | null;
          last_error_code: string | null; sent_at: string | null; attempted_at: string;
        },
        "institute_id" | "subscription_id" | "reminder_period_end" | "reminder_number" | "schedule_version" | "channel" | "delivery_status" | "idempotency_key"
      >;
      platform_subscription_plans: Table<
        {
          id: string; name: string; description: string | null; monthly_price: number; annual_price: number;
          monthly_compare_at_price: number | null; annual_compare_at_price: number | null;
          available_from: string | null; available_until: string | null;
          monthly_duration_days: number; annual_duration_days: number;
          trial_days: number; student_limit: number | null; staff_limit: number | null; branch_limit: number | null;
          features: Json; is_recommended: boolean; is_available: boolean; created_at: string; updated_at: string;
        },
        "name"
      >;
      platform_announcements: Table<
        {
          id: string; title: string; body: string; is_published: boolean; published_at: string | null;
          created_by: string | null; updated_by: string | null; created_at: string; updated_at: string;
        },
        "title" | "body"
      >;
      platform_notification_reads: Table<
        { user_id: string; institute_id: string; notification_key: string; read_at: string },
        "user_id" | "institute_id" | "notification_key"
      >;
      institute_subscriptions: Table<
        {
          id: string; institute_id: string; plan_id: string | null;
          status: "trialing" | "active" | "past_due" | "suspended" | "cancelled" | "expired";
          billing_cycle: "monthly" | "annual"; trial_ends_at: string | null;
          current_period_start: string | null; current_period_end: string | null;
          grace_period_ends_at: string | null; pending_plan_id: string | null; pending_billing_cycle: "monthly" | "annual" | null;
          free_access_enabled: boolean;
          created_at: string; updated_at: string;
        },
        "institute_id"
      >;
      platform_admin_audit_events: Table<
        {
          id: string; actor_user_id: string | null; action: string; target_type: string;
          target_id: string | null; details: Json; created_at: string;
        },
        "action" | "target_type"
      >;
      platform_subscription_invoices: Table<
        {
          id: string; institute_id: string; subscription_id: string | null; invoice_number: string;
          billing_period_start: string; billing_period_end: string; amount: number; currency: "INR";
          status: "draft" | "open" | "paid" | "past_due" | "void"; due_at: string | null;
          paid_at: string | null; created_at: string; updated_at: string;
        },
        "institute_id" | "invoice_number" | "billing_period_start" | "billing_period_end" | "amount"
      >;
      platform_payment_attempts: Table<
        {
          id: string; invoice_id: string; institute_id: string; provider: "razorpay" | "cashfree";
          provider_order_id: string | null; provider_payment_id: string | null;
          status: "created" | "pending" | "authorized" | "paid" | "failed" | "cancelled" | "refunded" | "reconciliation_required";
          verified_at: string | null; idempotency_key: string; attempt_number: number;
          safe_error_code: string | null; initiated_by: string | null; created_at: string; updated_at: string;
        },
        "invoice_id" | "institute_id" | "provider" | "status" | "idempotency_key" | "attempt_number"
      >;
      platform_subscription_payment_events: Table<
        {
          id: string; attempt_id: string; invoice_id: string; institute_id: string;
          provider: "razorpay" | "cashfree"; provider_event_id: string; provider_order_id: string;
          provider_payment_id: string | null; event_type: string;
          observed_status: "pending" | "authorized" | "captured" | "failed" | "cancelled";
          result_status: "pending" | "authorized" | "paid" | "failed" | "cancelled" | "reconciliation_required" | "duplicate_event";
          payload_sha256: string | null; created_at: string;
        },
        "attempt_id" | "invoice_id" | "institute_id" | "provider" | "provider_event_id" | "provider_order_id" | "event_type" | "observed_status" | "result_status",
        [
          Relationship<"platform_subscription_payment_events_attempt_tenant_fkey", ["attempt_id", "invoice_id", "institute_id"], "platform_payment_attempts", ["id", "invoice_id", "institute_id"]>,
          Relationship<"platform_subscription_payment_events_invoice_tenant_fkey", ["invoice_id", "institute_id"], "platform_subscription_invoices", ["id", "institute_id"]>,
        ]
      >;
      platform_subscription_events: Table<
        {
          id: string; institute_id: string; subscription_id: string | null; actor_user_id: string | null;
          event_type: string; reason: string | null; details: Json; created_at: string;
        },
        "institute_id" | "event_type"
      >;
      profiles: Table<
        { id: string; display_name: string | null; workspace_preferences: Json; created_at: string; updated_at: string },
        "id"
      >;
      coaching_institutes: Table<
        {
          id: string; business_name: string; owner_name: string | null; phone: string | null;
          whatsapp: string | null; email: string | null; website: string | null; address: string | null;
          city: string | null; state: string | null; pincode: string | null; gstin: string | null; time_zone: string; logo_path: string | null;
          legacy_data: Json; created_by: string | null; account_status: "active" | "suspended";
          suspension_reason: string | null; suspended_at: string | null; suspended_by: string | null;
          created_at: string; updated_at: string;
        },
        "business_name"
      >;
      user_memberships: Table<
        {
          institute_id: string; user_id: string;
          role: "owner" | "administrator" | "accountant" | "staff";
          access_scope: "institute" | "branches"; is_active: boolean; created_by: string | null;
          created_at: string; updated_at: string;
        },
        "institute_id" | "user_id" | "role",
        [Relationship<"user_memberships_institute_id_fkey", ["institute_id"], "coaching_institutes", ["id"]>]
      >;
      branches: Table<
        {
          id: string; institute_id: string; name: string; branch_login_email: string | null; address: string | null; phone: string | null;
          is_active: boolean; created_at: string; updated_at: string;
        },
        "institute_id" | "name" | "branch_login_email",
        [Relationship<"branches_institute_id_fkey", ["institute_id"], "coaching_institutes", ["id"]>]
      >;
      membership_branch_access: Table<
        {
          institute_id: string; user_id: string; branch_id: string;
          granted_by: string | null; created_at: string;
        },
        "institute_id" | "user_id" | "branch_id",
        [
          Relationship<"membership_branch_access_institute_id_user_id_fkey", ["institute_id", "user_id"], "user_memberships", ["institute_id", "user_id"]>,
          Relationship<"membership_branch_access_branch_id_institute_id_fkey", ["branch_id", "institute_id"], "branches", ["id", "institute_id"]>,
        ]
      >;
      students: Table<
        {
          id: string; institute_id: string; branch_id: string | null; name: string;
          gender: "Male" | "Female" | "Other" | null; parent_name: string | null;
          parent_email: string | null; parent_email_opt_in: boolean; whatsapp_opt_in: boolean;
          email_receipt_opt_in: boolean; whatsapp_receipt_opt_in: boolean;
          parent_mobile: string | null; whatsapp: string | null; course: string | null;
          class_name: string | null; admission_date: string | null; total_fee: number;
            admission_fee: number; archived_at: string | null;
            admission_cancelled_at: string | null; admission_cancellation_reason: string | null; legacy_data: Json;
          created_by: string | null; created_at: string; updated_at: string;
        },
        "institute_id" | "name",
        [
          Relationship<"students_institute_id_fkey", ["institute_id"], "coaching_institutes", ["id"]>,
          Relationship<"students_branch_id_institute_id_fkey", ["branch_id", "institute_id"], "branches", ["id", "institute_id"]>,
        ]
      >;
      staff: Table<
        {
          id: string; institute_id: string; branch_id: string | null; name: string;
          gender: "Male" | "Female" | "Other" | null; mobile: string | null; whatsapp: string | null;
          designation: string | null; joining_date: string | null; monthly_salary: number;
          payment_day: number | null; per_day_leave_cut: number; manual_payable_amount: number | null;
          salary_calculation_mode: SalaryCalculationMode;
          attendance_enabled: boolean; archived_at: string | null; legacy_data: Json;
          created_by: string | null; created_at: string; updated_at: string;
        },
        "institute_id" | "name",
        [
          Relationship<"staff_institute_id_fkey", ["institute_id"], "coaching_institutes", ["id"]>,
          Relationship<"staff_branch_id_institute_id_fkey", ["branch_id", "institute_id"], "branches", ["id", "institute_id"]>,
        ]
      >;
      attendance_records: Table<
        {
          id: string; institute_id: string; branch_id: string | null; staff_id: string;
          attendance_date: string; status: "Present" | "Absent" | "Leave" | "Holiday";
          note: string | null; created_by: string | null; created_at: string; updated_at: string;
        },
        "institute_id" | "staff_id" | "attendance_date" | "status",
        [
          Relationship<"attendance_records_staff_id_institute_id_fkey", ["staff_id", "institute_id"], "staff", ["id", "institute_id"]>,
          Relationship<"attendance_records_branch_id_institute_id_fkey", ["branch_id", "institute_id"], "branches", ["id", "institute_id"]>,
        ]
      >;
      student_installments: Table<
        {
          id: string; institute_id: string; branch_id: string | null; student_id: string;
          sequence_number: number; scheduled_amount: number; due_date: string | null; reminder_schedule_version: number;
          status: "Pending" | "Partially Paid" | "Paid" | "Overdue" | "Cancelled";
          legacy_data: Json; created_by: string | null; created_at: string; updated_at: string;
        },
        "institute_id" | "student_id" | "sequence_number" | "scheduled_amount",
        [
          Relationship<"student_installments_student_id_institute_id_fkey", ["student_id", "institute_id"], "students", ["id", "institute_id"]>,
          Relationship<"student_installments_branch_id_institute_id_fkey", ["branch_id", "institute_id"], "branches", ["id", "institute_id"]>,
        ]
      >;
      payments: Table<
        {
          id: string; institute_id: string; branch_id: string | null; student_id: string;
          receipt_kind: "Fee" | "Advance"; amount: number; currency: "INR"; payment_date: string;
          method: PaymentMethod; mode: "Manual" | "Online"; status: PaymentStatus;
          provider: "razorpay" | "cashfree" | null; provider_order_id: string | null;
          provider_payment_id: string | null; provider_reference: string | null; verified_at: string | null;
          idempotency_key: string | null; request_fingerprint: string | null; note: string | null;
          legacy_data: Json; created_by: string | null; created_at: string; updated_at: string;
        },
        "institute_id" | "student_id" | "receipt_kind" | "amount" | "payment_date" | "method" | "mode",
        [
          Relationship<"payments_student_id_institute_id_fkey", ["student_id", "institute_id"], "students", ["id", "institute_id"]>,
          Relationship<"payments_branch_id_institute_id_fkey", ["branch_id", "institute_id"], "branches", ["id", "institute_id"]>,
        ]
      >;
      fee_receipts: Table<
        {
          id: string; institute_id: string; branch_id: string | null; student_id: string;
          payment_id: string; receipt_number: string; created_at: string;
        },
        "institute_id" | "student_id" | "payment_id" | "receipt_number",
        [
          Relationship<"fee_receipts_payment_id_institute_id_student_id_fkey", ["payment_id", "institute_id", "student_id"], "payments", ["id", "institute_id", "student_id"]>,
          Relationship<"fee_receipts_branch_id_institute_id_fkey", ["branch_id", "institute_id"], "branches", ["id", "institute_id"]>,
        ]
      >;
      fee_receipt_deliveries: Table<
        {
          id: string; receipt_id: string; channel: "WhatsApp" | "Email";
          delivery_status: "Queued" | "Processing" | "Sent" | "Failed" | "Unknown" | "Skipped";
          provider: string | null; provider_message_reference: string | null;
          recipient_fingerprint: string | null; idempotency_key: string; attempt_count: number;
          retryable: boolean; next_attempt_at: string | null; last_error_code: string | null;
          attempted_at: string | null; sent_at: string | null; created_at: string; updated_at: string;
        },
        "receipt_id" | "channel",
        [Relationship<"fee_receipt_deliveries_receipt_id_fkey", ["receipt_id"], "fee_receipts", ["id"]>]
      >;
      payment_allocations: Table<
        {
          id: string; institute_id: string; payment_id: string; student_id: string;
          installment_id: string; allocation_kind: "Fee" | "Advance"; amount: number;
          legacy_data: Json; allocated_at: string; created_by: string | null; created_at: string;
        },
        "institute_id" | "payment_id" | "student_id" | "installment_id" | "allocation_kind" | "amount",
        [
          Relationship<"payment_allocations_payment_id_institute_id_student_id_fkey", ["payment_id", "institute_id", "student_id"], "payments", ["id", "institute_id", "student_id"]>,
          Relationship<"payment_allocations_installment_id_institute_id_student_id_fkey", ["installment_id", "institute_id", "student_id"], "student_installments", ["id", "institute_id", "student_id"]>,
        ]
      >;
      refunds: Table<
        {
          id: string; institute_id: string; branch_id: string | null; payment_id: string;
          student_id: string; amount: number; status: RefundStatus; reason: string;
          mode: "Manual" | "Online"; legacy_data: Json; provider_refund_reference: string | null;
          requested_by: string | null; completed_by: string | null; completed_at: string | null;
          created_at: string; updated_at: string;
        },
        "institute_id" | "payment_id" | "student_id" | "amount" | "reason" | "mode",
        [
          Relationship<"refunds_payment_id_institute_id_student_id_fkey", ["payment_id", "institute_id", "student_id"], "payments", ["id", "institute_id", "student_id"]>,
          Relationship<"refunds_branch_id_institute_id_fkey", ["branch_id", "institute_id"], "branches", ["id", "institute_id"]>,
        ]
      >;
      refund_allocations: Table<
        {
          id: string; institute_id: string; refund_id: string; payment_id: string;
          payment_allocation_id: string; amount: number; created_at: string;
        },
        "institute_id" | "refund_id" | "payment_id" | "payment_allocation_id" | "amount",
        [
          Relationship<"refund_allocations_refund_id_institute_id_payment_id_fkey", ["refund_id", "institute_id", "payment_id"], "refunds", ["id", "institute_id", "payment_id"]>,
          Relationship<"refund_allocations_payment_allocation_id_institute_id_payment_id_fkey", ["payment_allocation_id", "institute_id", "payment_id"], "payment_allocations", ["id", "institute_id", "payment_id"]>,
        ]
      >;
      salary_payments: Table<
        {
          institute_id: string; branch_id: string | null; staff_id: string; payroll_month: string;
          base_salary: number; manual_payable_amount: number | null;
          amount: number; status: "Paid"; paid_at: string; method: PaymentMethod | null;
          reference: string | null; notes: string | null;
          salary_calculation_mode: SalaryCalculationMode | null; attendance_deduction: number | null;
          manual_adjustment: number | null; legacy_data: Json;
          created_by: string | null; created_at: string; updated_at: string;
        },
        "institute_id" | "staff_id" | "payroll_month" | "base_salary" | "amount" | "paid_at",
        [
          Relationship<"salary_payments_staff_id_institute_id_fkey", ["staff_id", "institute_id"], "staff", ["id", "institute_id"]>,
          Relationship<"salary_payments_branch_id_institute_id_fkey", ["branch_id", "institute_id"], "branches", ["id", "institute_id"]>,
        ]
      >;
      expenses: Table<
        {
          id: string; institute_id: string; branch_id: string | null; title: string; category: string;
          amount: number; expense_date: string; method: PaymentMethod | null; notes: string | null; legacy_data: Json;
          recurring_rule_id: string | null; recurring_due_month: string | null;
          payment_status: "paid" | "unpaid"; payment_due_date: string | null; paid_at: string | null;
          voided_at: string | null; voided_by: string | null; void_reason: string | null;
          created_by: string | null; created_at: string; updated_at: string;
        },
        "institute_id" | "title" | "category" | "amount" | "expense_date",
        [
          Relationship<"expenses_institute_id_fkey", ["institute_id"], "coaching_institutes", ["id"]>,
          Relationship<"expenses_branch_id_institute_id_fkey", ["branch_id", "institute_id"], "branches", ["id", "institute_id"]>,
          Relationship<"expenses_recurring_rule_institute_fkey", ["recurring_rule_id", "institute_id"], "recurring_expense_rules", ["id", "institute_id"]>,
        ]
      >;
      recurring_expense_rules: Table<
        {
          id: string; institute_id: string; branch_id: string | null; title: string; category: string;
          amount: number; default_method: PaymentMethod; due_day: number; start_month: string;
          ends_on: string | null; notes: string | null; created_by: string | null;
          created_at: string; updated_at: string;
        },
        "id" | "institute_id" | "title" | "category" | "amount" | "default_method" | "due_day" | "start_month",
        [
          Relationship<"recurring_expense_rules_institute_id_fkey", ["institute_id"], "coaching_institutes", ["id"]>,
          Relationship<"recurring_expense_rules_branch_id_institute_id_fkey", ["branch_id", "institute_id"], "branches", ["id", "institute_id"]>,
        ]
      >;
      legacy_expense_imports: Table<
        {
          id: string; institute_id: string; branch_id: string | null; source_key: string;
          source_record_id: string; source_fingerprint: string; expense_id: string;
          imported_by: string; imported_at: string;
        },
        "institute_id" | "source_key" | "source_record_id" | "source_fingerprint" | "expense_id" | "imported_by",
        [
          Relationship<"legacy_expense_imports_branch_id_institute_id_fkey", ["branch_id", "institute_id"], "branches", ["id", "institute_id"]>,
          Relationship<"legacy_expense_imports_expense_id_institute_id_fkey", ["expense_id", "institute_id"], "expenses", ["id", "institute_id"]>,
        ]
      >;
      legacy_business_profile_imports: Table<
        {
          id: string; institute_id: string; source_key: string; source_fingerprint: string;
          imported_fields: string[]; skipped_fields: string[]; imported_by: string; imported_at: string;
        },
        "institute_id" | "source_key" | "source_fingerprint" | "imported_by",
        [Relationship<"legacy_business_profile_imports_institute_id_fkey", ["institute_id"], "coaching_institutes", ["id"]>]
      >;
      audit_logs: Table<
        {
          id: string; institute_id: string; branch_id: string | null; entity_type: string;
          entity_id: string; action: "INSERT" | "UPDATE" | "DELETE"; actor_id: string | null;
          occurred_at: string; metadata: Json;
        },
        "institute_id" | "entity_type" | "entity_id" | "action",
        [Relationship<"audit_logs_institute_id_fkey", ["institute_id"], "coaching_institutes", ["id"]>]
      >;
      notification_logs: Table<
        {
          id: string; institute_id: string; branch_id: string | null; channel: "Email" | "WhatsApp";
          event_type: string; delivery_status: "Queued" | "Processing" | "Sent" | "Delivered" | "Failed" | "Unknown" | "Skipped";
          provider: string | null; provider_message_reference: string | null; recipient_fingerprint: string | null;
          reminder_installment_id: string | null; reminder_number: number | null;
          reminder_schedule_version: number | null; reminder_due_date: string | null; idempotency_key: string | null;
          attempt_count: number; retryable: boolean; next_attempt_at: string | null; last_error_code: string | null;
          sent_at: string | null; attempted_by: string | null; attempted_at: string;
        },
        "institute_id" | "channel" | "event_type" | "delivery_status",
        [Relationship<"notification_logs_institute_id_fkey", ["institute_id"], "coaching_institutes", ["id"]>]
      >;
      payment_connections: Table<
        {
          id: string; institute_id: string; provider: "razorpay" | "cashfree";
          merchant_account_reference: string | null; secret_reference: string | null;
          environment: "test" | "production"; connection_status: "inactive" | "pending" | "active" | "disabled";
          last_verified_at: string | null; last_verified_reference: string | null;
          created_at: string; updated_at: string;
        },
        "institute_id" | "provider",
        [Relationship<"payment_connections_institute_id_fkey", ["institute_id"], "coaching_institutes", ["id"]>]
      >;
      notification_provider_connections: Table<
        {
          id: string; institute_id: string; provider: "resend" | "whatsapp_cloud";
          account_reference: string | null; secret_reference: string | null;
          environment: "test" | "production"; connection_status: "inactive" | "pending" | "active" | "disabled";
          created_at: string; updated_at: string;
        },
        "institute_id" | "provider",
        [Relationship<"notification_provider_connections_institute_id_fkey", ["institute_id"], "coaching_institutes", ["id"]>]
      >;
      payment_orders: Table<
        {
          id: string; institute_id: string; branch_id: string | null; student_id: string;
          provider: "razorpay" | "cashfree"; provider_order_id: string | null; idempotency_key: string;
          amount: number; currency: "INR";
          order_status: "Pending" | "Processing" | "Authorized" | "Captured" | "Failed" | "Cancelled" | "Expired";
          receipt_kind: "Fee" | "Advance" | null; installment_id: string | null;
          allocation_amount: number | null; request_fingerprint: string | null; safe_error_code: string | null;
          payment_id: string | null; created_by: string | null; created_at: string; updated_at: string;
        },
        "institute_id" | "student_id" | "provider" | "idempotency_key" | "amount",
        [
          Relationship<"payment_orders_student_id_institute_id_fkey", ["student_id", "institute_id"], "students", ["id", "institute_id"]>,
          Relationship<"payment_orders_payment_id_institute_id_student_id_fkey", ["payment_id", "institute_id", "student_id"], "payments", ["id", "institute_id", "student_id"]>,
          Relationship<"payment_orders_branch_id_institute_id_fkey", ["branch_id", "institute_id"], "branches", ["id", "institute_id"]>,
        ]
      >;
      payment_checkout_links: Table<
        {
          id: string; institute_id: string; payment_order_id: string; token_sha256: string;
          expires_at: string; revoked_at: string | null; created_by: string | null; created_at: string;
        },
        "institute_id" | "payment_order_id" | "token_sha256" | "expires_at",
        [Relationship<"payment_checkout_links_payment_order_fkey", ["payment_order_id", "institute_id"], "payment_orders", ["id", "institute_id"]>]
      >;
      webhook_events: Table<
        {
          id: string; institute_id: string; provider: "razorpay" | "cashfree"; provider_event_id: string;
          event_type: string; payload_sha256: string;
          processing_status: "Received" | "Processing" | "Processed" | "Failed" | "Ignored";
          received_at: string; processed_at: string | null;
        },
        "institute_id" | "provider" | "provider_event_id" | "event_type" | "payload_sha256",
        [Relationship<"webhook_events_institute_id_fkey", ["institute_id"], "coaching_institutes", ["id"]>]
      >;
      payment_reconciliation_records: Table<
        {
          id: string; institute_id: string; provider: "razorpay" | "cashfree"; payment_id: string | null;
          provider_transaction_reference: string; provider_amount: number; currency: "INR";
          reconciliation_status: "Matched" | "Unmatched" | "Amount Mismatch" | "Reference Mismatch" | "Ignored";
          reconciled_at: string; reconciled_by: string | null; notes: string | null;
        },
        "institute_id" | "provider" | "provider_transaction_reference" | "provider_amount" | "reconciliation_status",
        [
          Relationship<"payment_reconciliation_records_institute_id_fkey", ["institute_id"], "coaching_institutes", ["id"]>,
          Relationship<"payment_reconciliation_records_payment_id_institute_id_fkey", ["payment_id", "institute_id"], "payments", ["id", "institute_id"]>,
        ]
      >;
    };
    Views: {
      installment_balances: View<{
        installment_id: string; institute_id: string; branch_id: string | null; student_id: string;
        sequence_number: number; scheduled_amount: number; due_date: string | null;
        scheduled_status: "Pending" | "Partially Paid" | "Paid" | "Overdue" | "Cancelled";
        paid_amount: number; outstanding_amount: number;
        balance_status: "Cancelled" | "Paid" | "Partially Paid" | "Overdue" | "Pending";
        legacy_data: Json;
      }>;
      advance_balances: View<{
        payment_id: string; institute_id: string; branch_id: string | null; student_id: string;
        receipt_kind: "Fee" | "Advance"; received_amount: number; available_advance: number;
      }>;
      payment_history: View<{
        id: string; institute_id: string; branch_id: string | null;
        type: "Fee" | "Advance" | "Salary" | "Expense"; person_id: string; person_name: string;
        description: string; amount: number; paid_at: string; method: PaymentMethod | null;
      }>;
      financial_activity: View<{
        source_id: string; institute_id: string; branch_id: string | null;
        source_type: "receipt" | "refund" | "salary_payment" | "expense";
        category: "student_advance_receipt" | "student_fee_receipt" | "student_refund" | "salary_expense" | "business_expense";
        amount: number; direction: "inflow" | "outflow"; activity_date: string | null;
      }>;
      financial_activity_summary: View<{
        institute_id: string; branch_id: string | null; activity_month: string;
        category: "student_advance_receipt" | "student_fee_receipt" | "student_refund" | "salary_expense" | "business_expense";
        direction: "inflow" | "outflow"; record_count: number; amount_total: number;
      }>;
      installment_balance_summary: View<{
        institute_id: string; branch_id: string | null;
        balance_status: "Cancelled" | "Paid" | "Partially Paid" | "Overdue" | "Pending";
        installment_count: number; paid_amount_total: number; outstanding_amount_total: number;
      }>;
      student_receipt_balances: View<{
        institute_id: string; branch_id: string | null; student_id: string; receipt_count: number;
        receipt_total: number; completed_refund_total: number; net_receipts: number;
      }>;
    };
    Functions: {
      activate_payment_connection_after_sandbox_check: {
        Args: { p_institute_id: string; p_provider: "razorpay" | "cashfree"; p_actor_user_id: string; p_provider_order_reference: string };
        Returns: Json;
      };
      create_online_payment_order_intent: {
        Args: {
          p_institute_id: string; p_branch_id: string | null; p_student_id: string;
          p_provider: "razorpay" | "cashfree"; p_receipt_kind: "Fee" | "Advance";
          p_amount: number; p_installment_id: string | null; p_allocation_amount: number;
          p_idempotency_key: string;
        };
        Returns: Json;
      };
      create_payment_checkout_link: {
        Args: { p_order_id: string; p_token_sha256: string };
        Returns: Json;
      };
      revoke_payment_checkout_link: { Args: { p_order_id: string }; Returns: number };
      resolve_payment_checkout_link: { Args: { p_token_sha256: string }; Returns: Json };
      bind_online_provider_order: { Args: { p_order_id: string; p_provider_order_id: string }; Returns: undefined };
      fail_online_provider_order_creation: { Args: { p_order_id: string; p_safe_error_code: string }; Returns: undefined };
      process_online_payment_status: {
        Args: {
          p_provider: "razorpay" | "cashfree"; p_provider_order_id: string;
          p_provider_payment_id: string | null;
          p_provider_status: "captured" | "authorized" | "pending" | "failed" | "cancelled";
          p_provider_amount: number | string | null; p_currency: string | null;
          p_provider_event_id?: string | null; p_event_type?: string | null; p_payload_sha256?: string | null;
        };
        Returns: Json;
      };
      start_platform_subscription_payment_attempt: {
        Args: { p_invoice_id: string; p_provider: "razorpay" | "cashfree"; p_idempotency_key: string; p_actor_user_id: string };
        Returns: Json;
      };
      bind_platform_subscription_provider_order: {
        Args: { p_attempt_id: string; p_provider_order_id: string };
        Returns: Json;
      };
      finalize_platform_subscription_payment: {
        Args: {
          p_attempt_id: string; p_provider_order_id: string; p_provider_payment_id: string | null;
          p_provider_status: "captured" | "pending" | "authorized" | "failed" | "cancelled";
          p_provider_amount: number | string | null; p_currency: string | null; p_provider_event_id: string;
          p_event_type: string; p_payload_sha256?: string | null;
        };
        Returns: Json;
      };
      is_platform_administrator: { Args: Record<PropertyKey, never>; Returns: boolean };
      get_platform_admin_role: { Args: Record<PropertyKey, never>; Returns: "owner" | "operator" | "support" | null };
      platform_admin_overview: {
        Args: { p_search?: string | null; p_limit?: number; p_offset?: number };
        Returns: Json;
      };
      platform_admin_overview_safe: {
        Args: { p_search?: string | null; p_limit?: number; p_offset?: number };
        Returns: Json;
      };
      set_platform_admin_role: { Args: { p_user_id: string; p_role: "owner" | "operator" | "support" }; Returns: undefined };
      remove_platform_admin: { Args: { p_user_id: string }; Returns: undefined };
      provision_first_platform_owner: { Args: { p_user_id: string }; Returns: undefined };
      set_platform_institute_status: {
        Args: { p_institute_id: string; p_status: "active" | "suspended"; p_reason?: string | null };
        Returns: Json;
      };
      set_platform_institute_free_access: {
        Args: { p_institute_id: string; p_enabled: boolean; p_reason: string };
        Returns: string | null;
      };
      save_platform_subscription_plan: {
        Args: {
          p_plan_id: string | null; p_name: string; p_description: string | null;
          p_monthly_price: number; p_annual_price: number; p_trial_days: number;
          p_student_limit: number | null; p_staff_limit: number | null; p_branch_limit: number | null;
          p_features: Json; p_is_available: boolean;
        };
        Returns: string;
      };
      save_platform_subscription_plan_with_markdown: {
        Args: {
          p_plan_id: string | null; p_name: string; p_description: string | null;
          p_monthly_price: number; p_annual_price: number;
          p_monthly_compare_at_price: number | null; p_annual_compare_at_price: number | null;
          p_trial_days: number; p_student_limit: number | null; p_staff_limit: number | null;
          p_branch_limit: number | null; p_features: Json; p_is_available: boolean;
        };
        Returns: string;
      };
      save_platform_plan_pricing: {
        Args: {
          p_monthly_price: number; p_annual_price: number;
          p_monthly_compare_at_price: number | null; p_annual_compare_at_price: number | null;
          p_available_from: string | null; p_available_until: string | null;
          p_monthly_duration_days: number; p_annual_duration_days: number;
        };
        Returns: string;
      };
      save_platform_subscription_plan_pricing: {
        Args: {
          p_plan_id: string | null; p_name: string;
          p_monthly_price: number; p_annual_price: number;
          p_monthly_compare_at_price: number | null; p_annual_compare_at_price: number | null;
          p_available_from: string | null; p_available_until: string | null;
          p_monthly_duration_days: number; p_annual_duration_days: number; p_is_available: boolean;
        };
        Returns: string;
      };
      get_public_subscription_plans: { Args: Record<PropertyKey, never>; Returns: Json };
      set_platform_receipt_delivery_enabled: {
        Args: { p_provider_scope: "email" | "whatsapp"; p_enabled: boolean };
        Returns: Json;
      };
      save_platform_fee_receipt_policy: {
        Args: {
          p_delivery_channels: Json; p_template_title: string; p_accent_color: string; p_footer_note: string;
          p_show_installment_schedule: boolean; p_show_payment_reference: boolean;
        };
        Returns: Json;
      };
      save_platform_fee_receipt_policy_v2: {
        Args: {
          p_delivery_channels: Json; p_template_title: string; p_accent_color: string; p_footer_note: string;
          p_show_installment_schedule: boolean; p_show_payment_reference: boolean; p_show_institute_logo: boolean;
          p_show_bizbook_brand_mark: boolean; p_bizbook_brand_name: string; p_terms_note: string;
        };
        Returns: Json;
      };
      save_platform_fee_receipt_policy_v3: {
        Args: {
          p_delivery_channels: Json; p_template_title: string; p_accent_color: string; p_footer_note: string;
          p_show_installment_schedule: boolean; p_show_payment_reference: boolean; p_show_institute_logo: boolean;
          p_show_bizbook_brand_mark: boolean; p_bizbook_brand_name: string; p_terms_note: string;
          p_show_watermark: boolean; p_watermark_size_percent: number; p_watermark_opacity_percent: number;
          p_title_bold: boolean; p_title_pill: boolean; p_show_paid_seal: boolean; p_paid_seal_color: string;
        };
        Returns: Json;
      };
      save_platform_fee_receipt_policy_v4: {
        Args: {
          p_delivery_channels: Json; p_template_title: string; p_accent_color: string; p_footer_note: string;
          p_show_installment_schedule: boolean; p_show_payment_reference: boolean; p_show_institute_logo: boolean;
          p_show_bizbook_brand_mark: boolean; p_bizbook_brand_name: string; p_terms_note: string;
          p_show_watermark: boolean; p_watermark_size_percent: number; p_watermark_opacity_percent: number;
          p_title_bold: boolean; p_title_pill: boolean; p_show_paid_seal: boolean; p_paid_seal_color: string;
          p_paid_seal_opacity_percent: number;
        };
        Returns: Json;
      };
      save_platform_fee_receipt_policy_v5: {
        Args: {
          p_delivery_channels: Json; p_template_title: string; p_accent_color: string; p_footer_note: string;
          p_show_installment_schedule: boolean; p_show_payment_reference: boolean; p_show_institute_logo: boolean;
          p_show_bizbook_brand_mark: boolean; p_bizbook_brand_name: string; p_terms_note: string;
          p_show_watermark: boolean; p_watermark_size_percent: number; p_watermark_opacity_percent: number;
          p_title_bold: boolean; p_title_pill: boolean; p_show_paid_seal: boolean; p_paid_seal_color: string;
          p_paid_seal_opacity_percent: number; p_paid_seal_size_percent: number;
        };
        Returns: Json;
      };
      save_platform_fee_receipt_policy_v6: {
        Args: {
          p_delivery_channels: Json; p_template_title: string; p_accent_color: string; p_footer_note: string;
          p_show_installment_schedule: boolean; p_show_payment_reference: boolean; p_show_institute_logo: boolean;
          p_show_bizbook_brand_mark: boolean; p_bizbook_brand_name: string; p_terms_note: string;
          p_show_watermark: boolean; p_watermark_size_percent: number; p_watermark_opacity_percent: number;
          p_title_bold: boolean; p_title_pill: boolean; p_show_paid_seal: boolean; p_paid_seal_color: string;
          p_paid_seal_opacity_percent: number; p_paid_seal_size_percent: number; p_header_color: string;
        };
        Returns: Json;
      };
      set_platform_fee_receipt_watermark_logo: {
        Args: { p_logo_path: string | null };
        Returns: Json;
      };
      create_coaching_institute_with_plan: {
        Args: { p_business_name: string; p_plan_id: string; p_billing_cycle: "monthly" | "annual"; p_start_trial: boolean };
        Returns: Json;
      };
      save_platform_announcement: {
        Args: { p_announcement_id: string | null; p_title: string; p_body: string; p_is_published: boolean };
        Returns: string;
      };
      list_workspace_updates: { Args: { p_institute_id: string }; Returns: Json };
      mark_workspace_updates_read: { Args: { p_institute_id: string; p_notification_keys: string[] }; Returns: number };
      create_self_service_subscription_invoice: { Args: { p_institute_id: string }; Returns: Json };
      assign_platform_subscription: {
        Args: {
          p_institute_id: string; p_plan_id: string | null;
          p_status: "trialing" | "active" | "past_due" | "suspended" | "cancelled" | "expired";
          p_billing_cycle: "monthly" | "annual";
          p_trial_ends_at: string | null; p_period_start: string | null;
          p_period_end: string | null; p_grace_period_ends_at: string | null;
        };
        Returns: string;
      };
      assign_platform_subscription_with_reason: {
        Args: {
          p_institute_id: string; p_plan_id: string | null;
          p_status: "trialing" | "active" | "past_due" | "suspended" | "cancelled" | "expired";
          p_billing_cycle: "monthly" | "annual"; p_trial_ends_at: string | null;
          p_period_start: string | null; p_period_end: string | null; p_grace_period_ends_at: string | null; p_reason: string;
        };
        Returns: string;
      };
      issue_platform_subscription_invoice: {
        Args: {
          p_institute_id: string; p_invoice_number: string;
          p_period_start: string; p_period_end: string; p_due_at: string | null;
        };
        Returns: Json;
      };
      has_platform_role: { Args: { p_roles: string[] }; Returns: boolean };
      save_platform_provider_credentials: {
        Args: {
          p_provider_scope: "payment" | "email" | "whatsapp";
          p_provider: "razorpay" | "cashfree" | "resend" | "whatsapp_cloud";
          p_account_reference: string | null;
          p_credentials: Json;
        };
        Returns: Json;
      };
      save_platform_reminder_policy: {
        Args: { p_is_enabled: boolean; p_schedule: Json };
        Returns: Json;
      };
      save_platform_subscription_reminder_policy: {
        Args: { p_is_enabled: boolean; p_schedule: Json };
        Returns: Json;
      };
      get_platform_provider_credentials: {
        Args: {
          p_provider_scope: "payment" | "email" | "whatsapp";
          p_provider: "razorpay" | "cashfree" | "resend" | "whatsapp_cloud";
          p_allow_pending?: boolean;
        };
        Returns: Json;
      };
      record_platform_provider_sandbox_check: {
        Args: {
          p_provider_scope: "payment" | "email" | "whatsapp";
          p_provider: "razorpay" | "cashfree" | "resend" | "whatsapp_cloud";
          p_check_type: "unpaid_order_created" | "test_email_accepted" | "phone_profile_read";
          p_actor_user_id: string;
        };
        Returns: Json;
      };
      create_platform_support_ticket: {
        Args: { p_institute_id: string; p_category: "account" | "billing" | "payments" | "data" | "other"; p_subject: string; p_message: string; p_idempotency_key: string };
        Returns: string;
      };
      list_my_platform_support_tickets: {
        Args: { p_institute_id: string; p_limit?: number; p_offset?: number };
        Returns: Json;
      };
      list_platform_support_tickets: {
        Args: { p_status?: string | null; p_limit?: number; p_offset?: number };
        Returns: Json;
      };
      reply_platform_support_ticket: {
        Args: { p_ticket_id: string; p_message: string; p_idempotency_key: string };
        Returns: string;
      };
      set_platform_support_ticket_state: {
        Args: { p_ticket_id: string; p_status: "open" | "in_progress" | "waiting_on_customer" | "resolved" | "closed"; p_priority: "low" | "normal" | "high" | "urgent" };
        Returns: Json;
      };
      create_coaching_institute: { Args: { p_business_name: string }; Returns: string };
      create_coaching_institute_with_configured_trial: { Args: { p_business_name: string }; Returns: string };
      save_platform_subscription_plan_details: {
        Args: {
          p_plan_id: string | null; p_name: string; p_description: string; p_monthly_price: number; p_annual_price: number;
          p_monthly_compare_at_price: number | null; p_annual_compare_at_price: number | null;
          p_available_from: string | null; p_available_until: string | null; p_monthly_duration_days: number; p_annual_duration_days: number;
          p_student_limit: number | null; p_staff_limit: number | null; p_branch_limit: number | null;
          p_features: Json; p_is_recommended: boolean; p_is_available: boolean;
        };
        Returns: string;
      };
      delete_platform_subscription_plan: { Args: { p_plan_id: string }; Returns: undefined };
      get_platform_subscription_trial_config: { Args: Record<PropertyKey, never>; Returns: Json };
      save_platform_subscription_trial_config: {
        Args: { p_enabled: boolean; p_duration_days: number; p_plan_id: string | null; p_for_new_accounts: boolean };
        Returns: Json;
      };
      start_subscription_plan_purchase: {
        Args: { p_institute_id: string; p_plan_id: string; p_billing_cycle: "monthly" | "annual" };
        Returns: Json;
      };
      cancel_unstarted_subscription_invoice: { Args: { p_invoice_id: string }; Returns: Json };
      create_member_access_invitation: {
        Args: {
          p_institute_id: string;
          p_email: string;
          p_role: "owner" | "administrator" | "accountant" | "staff";
          p_access_scope: "institute" | "branches";
          p_branch_ids?: string[];
        };
        Returns: Json;
      };
      list_my_member_access_invitations: {
        Args: Record<PropertyKey, never>;
        Returns: Array<{
          id: string; institute_id: string; institute_name: string;
          role: "owner" | "administrator" | "accountant" | "staff";
          access_scope: "institute" | "branches"; branch_ids: string[];
          expires_at: string; created_at: string;
        }>;
      };
      accept_member_access_invitation: { Args: { p_invitation_id: string }; Returns: Json };
      list_institute_members: {
        Args: { p_institute_id: string };
        Returns: Array<{
          user_id: string; email: string;
          role: "owner" | "administrator" | "accountant" | "staff";
          access_scope: "institute" | "branches"; is_active: boolean;
        }>;
      };
      list_member_access_invitations: {
        Args: { p_institute_id: string };
        Returns: Array<{
          id: string; email: string;
          role: "owner" | "administrator" | "accountant" | "staff";
          access_scope: "institute" | "branches"; branch_ids: string[]; expires_at: string;
        }>;
      };
      revoke_member_access_invitation: { Args: { p_invitation_id: string }; Returns: undefined };
      remove_institute_member: { Args: { p_institute_id: string; p_user_id: string }; Returns: undefined };
      record_manual_payment: {
        Args: {
          p_institute_id: string; p_branch_id: string | null; p_student_id: string;
          p_receipt_kind: "Fee" | "Advance"; p_amount: number; p_method: PaymentMethod; p_payment_date: string;
          p_reference?: string | null; p_note?: string | null;
          p_allocations?: Json; p_idempotency_key?: string | null; p_payment_id?: string | null;
        };
        Returns: string;
      };
      allocate_advance: {
        Args: { p_payment_id: string; p_installment_id: string; p_amount: number };
        Returns: string;
      };
      save_student_record: {
        Args: {
          p_institute_id: string; p_branch_id: string | null; p_student_id: string;
          p_student: Json; p_installments: Json;
        };
        Returns: string;
      };
      import_legacy_student_record: {
        Args: {
          p_institute_id: string; p_branch_id: string | null; p_source_key: string;
          p_source_record_id: string; p_source_fingerprint: string; p_student_id: string;
          p_student: Json; p_installments: Json; p_confirm_unpaid_schedule: boolean;
        };
        Returns: { imported_student_id: string; was_already_imported: boolean }[];
      };
      import_legacy_staff_record: {
        Args: {
          p_institute_id: string; p_branch_id: string | null; p_source_key: string;
          p_source_record_id: string; p_source_fingerprint: string; p_staff_id: string;
          p_name: string; p_gender: string | null; p_mobile: string | null; p_whatsapp: string | null;
          p_designation: string | null; p_joining_date: string | null; p_monthly_salary: number;
          p_payment_day: number | null; p_per_day_leave_cut: number; p_manual_payable_amount: number | null;
          p_salary_calculation_mode: string; p_attendance_enabled: boolean; p_confirm_profile_only: boolean;
        };
        Returns: { imported_staff_id: string; was_already_imported: boolean }[];
      };
      archive_student_record: {
        Args: { p_institute_id: string; p_student_id: string };
        Returns: undefined;
      };
      cancel_student_admission: {
        Args: { p_institute_id: string; p_student_id: string; p_reason: string };
        Returns: Json;
      };
      request_refund: {
        Args: {
          p_payment_id: string; p_amount: number; p_reason: string; p_mode: "Manual" | "Online";
          p_allocation_breakdown?: Json; p_refund_id?: string | null;
        };
        Returns: string;
      };
      request_online_refund: {
        Args: {
          p_payment_id: string; p_amount: number; p_reason: string;
          p_allocation_breakdown: Json; p_refund_id: string;
        };
        Returns: Json;
      };
      record_online_refund_status: {
        Args: {
          p_refund_id: string; p_provider: string; p_provider_refund_reference: string;
          p_provider_payment_id: string; p_provider_order_id: string; p_provider_amount: number;
          p_currency: string; p_status: string;
        };
        Returns: Json;
      };
      complete_manual_refund: { Args: { p_refund_id: string }; Returns: undefined };
      record_salary_payment: {
        Args: {
          p_institute_id: string; p_branch_id: string | null; p_staff_id: string;
          p_payroll_month: string; p_amount: number; p_paid_at: string;
          p_method?: PaymentMethod | null; p_reference?: string | null; p_notes?: string | null;
          p_manual_adjustment?: number | null;
        };
        Returns: undefined;
      };
      list_staff_compensation: {
        Args: { p_institute_id: string; p_branch_id?: string | null };
        Returns: {
          id: string; institute_id: string; branch_id: string | null; name: string;
          designation: string | null; joining_date: string | null; monthly_salary: number;
          payment_day: number | null; per_day_leave_cut: number; manual_payable_amount: number | null;
          salary_calculation_mode: SalaryCalculationMode; attendance_enabled: boolean;
        }[];
      };
      record_expense: {
        Args: {
          p_expense_id: string; p_institute_id: string; p_branch_id: string | null;
          p_title: string; p_category: string; p_amount: number; p_expense_date: string;
          p_method: PaymentMethod; p_notes?: string | null;
        };
        Returns: string;
      };
      record_expense_entry: {
        Args: {
          p_expense_id: string; p_institute_id: string; p_branch_id: string | null;
          p_title: string; p_category: string; p_amount: number; p_expense_date: string;
          p_payment_status: "paid" | "unpaid"; p_payment_due_date: string | null;
          p_paid_at: string | null; p_method: PaymentMethod | null; p_notes?: string | null;
        };
        Returns: string;
      };
      record_expense_payment: {
        Args: { p_expense_id: string; p_paid_at: string; p_method: PaymentMethod };
        Returns: string;
      };
      create_recurring_expense_rule: {
        Args: {
          p_rule_id: string; p_institute_id: string; p_branch_id: string | null;
          p_title: string; p_category: string; p_amount: number; p_default_method: PaymentMethod;
          p_due_day: number; p_start_month: string; p_notes?: string | null;
        };
        Returns: string;
      };
      record_recurring_expense_payment: {
        Args: { p_expense_id: string; p_rule_id: string; p_due_month: string; p_payment_date: string; p_method: PaymentMethod };
        Returns: string;
      };
      pause_recurring_expense_rule: {
        Args: { p_rule_id: string };
        Returns: string;
      };
      import_legacy_expense_record: {
        Args: {
          p_institute_id: string; p_branch_id: string | null; p_source_key: string;
          p_source_record_id: string; p_source_fingerprint: string; p_title: string; p_category: string;
          p_amount: number; p_expense_date: string; p_method: PaymentMethod; p_notes: string | null;
          p_confirm_historical_expense: boolean;
        };
        Returns: { imported_expense_id: string; was_already_imported: boolean }[];
      };
      import_legacy_expense_record_verified: {
        Args: {
          p_institute_id: string; p_branch_id: string | null; p_source_key: string;
          p_source_record_id: string; p_title: string; p_category: string; p_amount: number;
          p_expense_date: string; p_method: PaymentMethod; p_notes: string | null;
          p_confirm_historical_expense: boolean;
        };
        Returns: { imported_expense_id: string; was_already_imported: boolean }[];
      };
      import_legacy_business_profile: {
        Args: { p_institute_id: string; p_profile: Json; p_confirm_no_overwrite: boolean };
        Returns: { filled_fields: string[]; skipped_fields: string[]; was_already_imported: boolean }[];
      };
      update_expense: {
        Args: {
          p_expense_id: string; p_title: string; p_category: string; p_amount: number;
          p_expense_date: string; p_method: PaymentMethod; p_notes?: string | null;
        };
        Returns: undefined;
      };
      expense_month_summary: {
        Args: { p_institute_id: string; p_branch_id: string | null; p_month_start: string };
        Returns: { month_total: number; expense_count: number }[];
      };
      expense_dashboard_summary: {
        Args: { p_institute_id: string; p_branch_id: string | null; p_month_start: string };
        Returns: { recorded_month_total: number; unpaid_total: number; unpaid_count: number }[];
      };
      void_expense: { Args: { p_expense_id: string; p_reason: string }; Returns: undefined };
      save_payment_connection_credentials: {
        Args: {
          p_institute_id: string;
          p_provider: "razorpay" | "cashfree";
          p_merchant_account_reference: string;
          p_credentials: Json;
        };
        Returns: Json;
      };
      get_payment_connection_credentials: {
        Args: { p_institute_id: string; p_provider: "razorpay" | "cashfree" };
        Returns: Json;
      };
      save_notification_provider_credentials: {
        Args: {
          p_institute_id: string;
          p_provider: "resend" | "whatsapp_cloud";
          p_account_reference: string;
          p_credentials: Json;
        };
        Returns: Json;
      };
      get_notification_provider_credentials: {
        Args: { p_institute_id: string; p_provider: "resend" | "whatsapp_cloud"; p_allow_pending?: boolean };
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<Name extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][Name] extends { Row: infer Row } ? Row : never;
export type TablesInsert<Name extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][Name] extends { Insert: infer Insert } ? Insert : never;
export type TablesUpdate<Name extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][Name] extends { Update: infer Update } ? Update : never;

