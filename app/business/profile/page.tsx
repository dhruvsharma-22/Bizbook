"use client";
import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  Building2,
  MapPin,
  CheckCircle2,
  Upload,
  Pencil,
  X,
  Globe,
  Mail,
  Phone,
  MessageCircle,
  UserRound,
  Trash2,
  ShieldCheck,
  ArrowUpRight,
  Save,
  FileText,
} from "lucide-react";
import WorkspaceLayout from "@/components/layout/WorkspaceLayout";
import { useWorkspaceScope } from "@/components/layout/WorkspaceScopeContext";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isAuthorizedTestProjectConfigured } from "@/lib/supabase/workspace-scope";
type BusinessForm = {
  businessName: string;
  ownerName: string;
  phone: string;
  whatsapp: string;
  email: string;
  website: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  gstin: string;
};
const LOGO_BUCKET = "bizbook-institute-logos";
const initialForm: BusinessForm = {
  businessName: "",
  ownerName: "",
  phone: "",
  whatsapp: "",
  email: "",
  website: "",
  address: "",
  city: "",
  state: "",
  pincode: "",
  gstin: "",
};
const fieldLimits: Record<keyof BusinessForm, number> = {
  businessName: 100,
  ownerName: 100,
  phone: 10,
  whatsapp: 10,
  email: 254,
  website: 2048,
  address: 250,
  city: 50,
  state: 50,
  pincode: 6,
  gstin: 15,
};
const fieldsWithVisibleLimit: (keyof BusinessForm)[] = [
  "businessName",
  "ownerName",
  "address",
];
const inputClass =
  "w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#7C3AED] focus:ring-2 focus:ring-violet-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-600";
const redButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-[#7C3AED] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#6D28D9] disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50";
function SectionHeading({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-[#7C3AED]">
        {icon}
      </div>
      <div className="min-w-0">
        <h2 className="text-sm font-bold text-slate-900 sm:text-base">
          {title}
        </h2>
        <p className="mt-0.5 text-xs leading-5 text-slate-500 sm:text-sm">
          {description}
        </p>
      </div>
    </div>
  );
}
export default function BusinessProfilePage() {
  const workspaceScope = useWorkspaceScope();
  const instituteId = workspaceScope.selection?.instituteId ?? "";
  const [form, setForm] = useState<BusinessForm>(initialForm);
  const [savedForm, setSavedForm] =
    useState<BusinessForm>(initialForm);
  const [logo, setLogo] = useState("");
  const [savedLogo, setSavedLogo] = useState("");
  const [editing, setEditing] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    if (workspaceScope.loading) return;
    if (!isAuthorizedTestProjectConfigured()) {
      void Promise.resolve().then(() => {
        if (!active) return;
        setError("Business profile requires the authorized Supabase test project.");
        setLoaded(true);
      });
      return () => { active = false; };
    }
    if (!instituteId) {
      void Promise.resolve().then(() => {
        if (!active) return;
        setForm(initialForm);
        setSavedForm(initialForm);
        setLogo("");
        setSavedLogo("");
        setError("Join or create an institute before editing its business profile.");
        setLoaded(true);
      });
      return () => { active = false; };
    }
    void Promise.resolve().then(() => {
      if (!active) return;
      setLoaded(false);
      setError("");
    });
    void (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data, error: queryError } = await supabase
          .from("coaching_institutes")
          .select("business_name, owner_name, phone, whatsapp, email, website, address, city, state, pincode, gstin, logo_path")
          .eq("id", instituteId)
          .single();
        if (queryError || !data) throw new Error("Could not load the institute profile.");
        const restored: BusinessForm = {
          businessName: data.business_name ?? "",
          ownerName: data.owner_name ?? "",
          phone: data.phone ?? "",
          whatsapp: data.whatsapp ?? "",
          email: data.email ?? "",
          website: data.website ?? "",
          address: data.address ?? "",
          city: data.city ?? "",
          state: data.state ?? "",
          pincode: data.pincode ?? "",
          gstin: data.gstin ?? "",
        };
        let signedLogo = "";
        if (data.logo_path) {
          const { data: signed, error: signError } = await supabase.storage
            .from(LOGO_BUCKET)
            .createSignedUrl(data.logo_path, 3600);
          if (signError) throw new Error("Could not load the institute logo.");
          signedLogo = signed.signedUrl;
        }
        if (!active) return;
        setForm(restored);
        setSavedForm(restored);
        setLogo(signedLogo);
        setSavedLogo(signedLogo);
        setEditing(false);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load the institute profile.");
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => { active = false; };
  }, [instituteId, workspaceScope.loading]);
  function updateField(name: keyof BusinessForm, value: string) {
    setMessage("");
    setError("");
    if (
      name === "phone" ||
      name === "whatsapp" ||
      name === "pincode"
    ) {
      value = value.replace(/\D/g, "");
    }
    if (name === "gstin") {
      value = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    }
    value = value.slice(0, fieldLimits[name]);
    setForm((previous) => ({ ...previous, [name]: value }));
  }
  function handleLogoChange(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];
    if (!file) return;
    setMessage("");
    setError("");
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type)
    ) {
      setError("Upload a PNG, JPG, or WebP image.");
      event.target.value = "";
      return;
    }
    if (file.size > 1024 * 1024) {
      setError("Your logo must be smaller than 1 MB.");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setLogo(reader.result);
      }
    };
    reader.onerror = () => {
      setError("Could not read the selected logo.");
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");
    const businessName = form.businessName.trim();
    const ownerName = form.ownerName.trim();
    const email = form.email.trim();
    const website = form.website.trim();
    const gstin = form.gstin.trim();
    if (!businessName) {
      setError("Please enter your business name.");
      return;
    }
    if (!ownerName) {
      setError("Please enter the owner's name.");
      return;
    }
    if (!/^\d{10}$/.test(form.phone)) {
      setError("Enter a valid 10-digit mobile number.");
      return;
    }
    if (!/^\d{10}$/.test(form.whatsapp)) {
      setError("WhatsApp number must contain 10 digits.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!website) {
      setError("Please enter your business website.");
      return;
    }
    if (website) {
      try {
        const url = new URL(website);
        if (!["https:", "http:"].includes(url.protocol)) {
          setError("Website must start with http:// or https://.");
          return;
        }
      } catch {
        setError("Enter a valid website URL, including https://.");
        return;
      }
    }
    if (!/^\d{6}$/.test(form.pincode)) {
      setError("PIN code must contain exactly 6 digits.");
      return;
    }
    if (!form.address.trim() || !form.city.trim() || !form.state.trim()) {
      setError("Please complete your full address, city, and state.");
      return;
    }
    if (gstin && !/^[A-Z0-9]{15}$/.test(gstin)) {
      setError("GSTIN must contain exactly 15 letters or digits.");
      return;
    }
    const cleanedForm: BusinessForm = {
      ...form,
      businessName,
      ownerName,
      email,
      website,
      address: form.address.trim(),
      city: form.city.trim(),
      state: form.state.trim(),
      gstin,
    };
    if (!instituteId || !isAuthorizedTestProjectConfigured()) {
      setError("The selected institute is not connected to the authorized database.");
      return;
    }
    setSaving(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: current, error: currentError } = await supabase
        .from("coaching_institutes")
        .select("logo_path")
        .eq("id", instituteId)
        .single();
      if (currentError || !current) throw new Error("Could not verify the current institute profile.");
      let logoPath = current.logo_path;
      let uploadedPath: string | null = null;
      if (logo.startsWith("data:image/")) {
        const response = await fetch(logo);
        const image = await response.blob();
        const extension = image.type === "image/png" ? "png" : image.type === "image/webp" ? "webp" : "jpg";
        uploadedPath = `${instituteId}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from(LOGO_BUCKET)
          .upload(uploadedPath, image, { contentType: image.type, upsert: false });
        if (uploadError) throw new Error("Could not upload the institute logo.");
        logoPath = uploadedPath;
      } else if (!logo && savedLogo && current.logo_path) {
        logoPath = null;
      }
      const { data: updatedInstitute, error: updateError } = await supabase
        .from("coaching_institutes")
        .update({
          business_name: cleanedForm.businessName,
          owner_name: cleanedForm.ownerName,
          phone: cleanedForm.phone,
          whatsapp: cleanedForm.whatsapp || null,
          email: cleanedForm.email,
          website: cleanedForm.website || null,
          address: cleanedForm.address || null,
          city: cleanedForm.city || null,
          state: cleanedForm.state || null,
          pincode: cleanedForm.pincode || null,
          gstin: cleanedForm.gstin || null,
          logo_path: logoPath,
        })
        .eq("id", instituteId)
        .select("id")
        .maybeSingle();
      if (updateError || !updatedInstitute) {
        if (uploadedPath) await supabase.storage.from(LOGO_BUCKET).remove([uploadedPath]);
        throw new Error("Could not save the profile. Check that you have institute administrator access.");
      }
      if (!logoPath && current.logo_path) {
        await supabase.storage.from(LOGO_BUCKET).remove([current.logo_path]);
      } else if (uploadedPath && current.logo_path && current.logo_path !== uploadedPath) {
        await supabase.storage.from(LOGO_BUCKET).remove([current.logo_path]);
      }
      let savedLogoUrl = "";
      let logoPreviewWarning = false;
      if (logoPath) {
        const { data: signed, error: signError } = await supabase.storage
          .from(LOGO_BUCKET)
          .createSignedUrl(logoPath, 3600);
        if (signError) logoPreviewWarning = true;
        else savedLogoUrl = signed.signedUrl;
      }
      setForm(cleanedForm);
      setSavedForm(cleanedForm);
      setLogo(savedLogoUrl);
      setSavedLogo(savedLogoUrl);
      setEditing(false);
      setMessage(logoPreviewWarning ? "Profile saved. Refresh the page to reload the logo preview." : "Business profile saved successfully.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the institute profile.");
    } finally {
      setSaving(false);
    }
  }
  function handleEdit() {
    setForm(savedForm);
    setLogo(savedLogo);
    setEditing(true);
    setMessage("");
    setError("");
  }
  function handleCancel() {
    setForm(savedForm);
    setLogo(savedLogo);
    setEditing(false);
    setMessage("");
    setError("");
  }
  function renderInput(
    name: keyof BusinessForm,
    label: string,
    options: {
      required?: boolean;
      type?: string;
      icon?: React.ReactNode;
      placeholder?: string;
      helper?: string;
    } = {}
  ) {
    const showLimit = fieldsWithVisibleLimit.includes(name);
    return (
      <div key={name} className="min-w-0">
        <label
          htmlFor={name}
          className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-slate-700 sm:text-sm"
        >
          {label}
          {options.required && (
            <span className="text-[#7C3AED]">*</span>
          )}
        </label>
        <div className="relative">
          {options.icon && (
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              {options.icon}
            </span>
          )}
          <input
            id={name}
            name={name}
            type={options.type ?? "text"}
            value={form[name]}
            onChange={(event) =>
              updateField(name, event.target.value)
            }
            disabled={!editing}
            required={options.required}
            maxLength={fieldLimits[name]}
            placeholder={options.placeholder ?? ""}
            inputMode={
              ["phone", "whatsapp", "pincode"].includes(name)
                ? "numeric"
                : "text"
            }
            autoComplete={
              name === "email"
                ? "email"
                : name === "phone"
                  ? "tel"
                  : "off"
            }
            className={`${inputClass} ${
              options.icon ? "pl-9" : ""
            }`}
          />
        </div>
        {showLimit && (
          <div className="mt-1 text-right text-[10px] text-slate-400">
            {String(form[name]).length}/{fieldLimits[name]}
          </div>
        )}
        {options.helper && (
          <p className="mt-1 text-[11px] leading-4 text-slate-400">
            {options.helper}
          </p>
        )}
      </div>
    );
  }
  if (!loaded) {
    return (
      <WorkspaceLayout>
        <div className="mx-auto max-w-[1600px] space-y-4 px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
          <div className="h-32 animate-pulse rounded-2xl bg-slate-200" />
          <div className="h-56 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      </WorkspaceLayout>
    );
  }
  return (
    <WorkspaceLayout>
      <main className="bizbook-dashboard-canvas min-h-screen bg-gradient-to-br from-[#faf7ff] via-[#f8f6fc] to-[#f4f0fa]">
        <div className="mx-auto max-w-[1600px] space-y-5 px-3 py-4 sm:space-y-6 sm:px-6 sm:py-6 lg:px-8">
          {/* Shared BizBook dashboard-style header */}
          <header className="relative isolate overflow-hidden rounded-2xl bg-gradient-to-r from-[#3b0764] via-[#6d28d9] to-[#86198f] px-3.5 py-3 text-white shadow-[0_12px_32px_-22px_rgba(59,7,100,0.8)] sm:rounded-3xl sm:px-4 sm:py-3.5">
            <div aria-hidden="true" className="pointer-events-none absolute -right-8 -top-12 size-36 rounded-full border-[16px] border-fuchsia-200/10 sm:size-44" />
            <div aria-hidden="true" className="pointer-events-none absolute -bottom-16 left-1/3 size-32 rounded-full bg-violet-300/10 blur-2xl" />
            <div className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <p className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.13em] text-fuchsia-100">
                  <span className="size-1.5 rounded-full bg-emerald-300" aria-hidden="true" /> BIZBOOK · BUSINESS SETTINGS
                </p>
                <h1 className="mt-1 text-lg font-extrabold leading-tight tracking-tight sm:text-xl lg:text-2xl">
                  <span className="text-white">Business</span>{" "}
                  <span className="bg-gradient-to-r from-amber-200 via-pink-200 to-cyan-200 bg-clip-text text-transparent">Profile</span>
                </h1>
                <p className="mt-0.5 max-w-xl text-[11px] leading-4 text-violet-100 sm:text-xs">
                  Keep your business identity, contact details, and invoice information accurate in one place.
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                  <span className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/10 px-2 py-1 text-white">
                    <ShieldCheck size={12} aria-hidden="true" /> Invoice-ready details
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/10 px-2 py-1 text-violet-100">
                    <CheckCircle2 size={12} aria-hidden="true" /> {editing ? "Edit mode" : "Profile saved"}
                  </span>
                </div>
              </div>
              <div className="relative flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                {!editing ? (
                  <button
                    type="button"
                    onClick={handleEdit}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-200"
                  >
                    <Pencil size={15} aria-hidden="true" /> Edit Profile
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={handleCancel}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 text-xs font-bold text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-200"
                    >
                      <X size={15} aria-hidden="true" /> Cancel
                    </button>
                    <button
                      type="submit"
                      form="business-profile-form"
                      disabled={saving || !instituteId}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-white px-4 text-xs font-extrabold text-[#5b21b6] shadow-sm transition hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-200 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Save size={15} aria-hidden="true" /> {saving ? "Saving…" : "Save Changes"}
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="relative mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-white/15 pt-2 text-[10px] text-violet-100">
              <span>Profile details are used for <strong className="font-bold text-white">invoice generation</strong>.</span>
              <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5">GSTIN & logo optional</span>
            </div>
          </header>
          {message && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
            >
              <CheckCircle2 size={17} className="mt-0.5 shrink-0" />
              <p>{message}</p>
            </div>
          )}
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            >
              <X size={17} className="mt-0.5 shrink-0" />
              <p>{error}</p>
            </div>
          )}
          <div role="note" className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <FileText size={18} className="mt-0.5 shrink-0" />
            <p className="leading-5"><strong>Important:</strong> These business details will be used to generate invoices. Please ensure all required information is accurate. GSTIN and business logo are optional.</p>
          </div>
          <form
            id="business-profile-form"
            onSubmit={handleSubmit}
            className="space-y-4"
          >
            {/* Identity and compact logo */}
            <section className="rounded-2xl border border-white bg-white/95 p-4 shadow-[0_8px_30px_-24px_rgba(49,24,88,0.35)] ring-1 ring-violet-100/70 sm:p-5">
              <SectionHeading
                icon={<Building2 size={18} />}
                title="Business identity"
                description="Your business name and primary contact details."
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[110px_minmax(0,1fr)] sm:gap-5">
                {/* Small logo panel */}
                <div className="flex items-center gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-3 sm:flex-col sm:items-center sm:justify-start sm:p-3 sm:text-center">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white sm:h-16 sm:w-16">
                    {logo ? (
                      <Image
                        src={logo}
                        alt="Business logo preview"
                        width={64}
                        height={64}
                        unoptimized
                        className="h-full w-full object-contain p-1.5"
                      />
                    ) : (
                      <Building2
                        size={25}
                        strokeWidth={1.5}
                        className="text-slate-300"
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 sm:w-full sm:flex-none">
                    <p className="text-xs font-semibold text-slate-700">
                      {logo ? "Logo selected" : "Business logo"}
                    </p>
                    <p className="mt-0.5 text-[10px] leading-4 text-slate-400">
                      PNG, JPG, WebP · 1 MB max
                    </p>
                    {editing && (
                      <div className="mt-2 flex flex-wrap gap-1.5 sm:justify-center">
                        <button
                          type="button"
                          onClick={() =>
                            fileInputRef.current?.click()
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <Upload size={12} />
                          Upload
                        </button>
                        {logo && (
                          <button
                            type="button"
                            onClick={() => {
                              setLogo("");
                              setMessage("");
                              setError("");
                            }}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-semibold text-red-600 hover:bg-red-50"
                          >
                            <Trash2 size={12} />
                            Remove
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleLogoChange}
                    className="hidden"
                    aria-label="Upload business logo"
                  />
                </div>
                <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
                  {renderInput("businessName", "Business Name", {
                    required: true,
                    icon: <Building2 size={15} />,
                    placeholder: "Enter business name",
                  })}
                  {renderInput("ownerName", "Owner Name", {
                    required: true,
                    icon: <UserRound size={15} />,
                    placeholder: "Owner's full name",
                  })}
                  {renderInput("phone", "Mobile Number", {
                    required: true,
                    icon: <Phone size={15} />,
                    placeholder: "10-digit mobile number",
                  })}
                  {renderInput("whatsapp", "WhatsApp Number", {
                    required: true,
                    icon: <MessageCircle size={15} />,
                    placeholder: "10-digit WhatsApp number",
                    helper: "Required · 10 digits",
                  })}
                </div>
              </div>
            </section>
            {/* Contact */}
            <section className="rounded-2xl border border-white bg-white/95 p-4 shadow-[0_8px_30px_-24px_rgba(49,24,88,0.35)] ring-1 ring-violet-100/70 sm:p-5">
              <SectionHeading
                icon={<Globe size={18} />}
                title="Contact information"
                description="How customers can contact your business."
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {renderInput("email", "Business Email", {
                  required: true,
                  type: "email",
                  icon: <Mail size={15} />,
                  placeholder: "business@example.com",
                })}
                {renderInput("website", "Website", {
                  required: true,
                  type: "url",
                  icon: <Globe size={15} />,
                  placeholder: "https://yourwebsite.com",
                  helper: "Required · Include https:// or http://.",
                })}
              </div>
            </section>
            {/* Address */}
            <section className="rounded-2xl border border-white bg-white/95 p-4 shadow-[0_8px_30px_-24px_rgba(49,24,88,0.35)] ring-1 ring-violet-100/70 sm:p-5">
              <SectionHeading
                icon={<MapPin size={18} />}
                title="Business address"
                description="Where your business is located."
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  {renderInput("address", "Full Address", {
                    required: true,
                    icon: <MapPin size={15} />,
                    placeholder: "Street, area, building or landmark",
                  })}
                </div>
                {renderInput("city", "City", {
                  required: true,
                  placeholder: "Enter city",
                })}
                {renderInput("state", "State", {
                  required: true,
                  placeholder: "Enter state",
                })}
                {renderInput("pincode", "PIN Code", {
                  required: true,
                  placeholder: "6-digit PIN code",
                })}
              </div>
            </section>
            {/* Tax details */}
            <section className="rounded-2xl border border-white bg-white/95 p-4 shadow-[0_8px_30px_-24px_rgba(49,24,88,0.35)] ring-1 ring-violet-100/70 sm:p-5">
              <SectionHeading
                icon={<FileText size={18} />}
                title="Tax details"
                description="Add your GSTIN if it applies to your business."
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {renderInput("gstin", "GSTIN (optional)", {
                  placeholder: "15-character GSTIN",
                  helper: "Optional · Letters and numbers only",
                })}
              </div>
            </section>
            {editing && (
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[11px] leading-4 text-slate-400">
                  Fields marked with{" "}
                  <span className="text-red-500">*</span> are required.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleCancel}
                    className={`${secondaryButtonClass} flex-1 sm:flex-none`}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving || !instituteId}
                    className={`${redButtonClass} flex-1 sm:flex-none`}
                  >
                    <CheckCircle2 size={15} />
                    {saving ? "Saving…" : "Save Changes"}
                  </button>
                </div>
              </div>
            )}
          </form>
          {/* Compact information note */}
          <section className="flex items-start gap-3 rounded-xl border border-violet-100 bg-violet-50/70 p-3.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-[#5B21B6]">
              <ShieldCheck size={17} />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs font-bold text-[#5B21B6] sm:text-sm">
                Keep your profile up to date
              </h3>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                Accurate contact information helps customers reach your
                business.
              </p>
              <p className="mt-1 text-[10px] leading-4 text-slate-500">
                This version stores information in this browser only.
                It does not sync across devices or save to a server.
              </p>
            </div>
            <ArrowUpRight
              size={15}
              className="ml-auto shrink-0 text-[#5B21B6]"
            />
          </section>
          <footer className="pb-2 text-center text-[10px] text-slate-400">
            BizBook Business Settings
          </footer>
        </div>
      </main>
    </WorkspaceLayout>
  );
}
