type StudentAvatarProps = {
  studentId: string;
  name?: string;
  gender?: "Male" | "Female" | "Other";
  size?: number;
  className?: string;
};

const colorPairs = [
  { background: "bg-violet-800", foreground: "text-white" },
  { background: "bg-blue-800", foreground: "text-white" },
  { background: "bg-emerald-800", foreground: "text-white" },
  { background: "bg-amber-800", foreground: "text-white" },
  { background: "bg-rose-800", foreground: "text-white" },
  { background: "bg-cyan-900", foreground: "text-white" },
  { background: "bg-fuchsia-800", foreground: "text-white" },
  { background: "bg-orange-800", foreground: "text-white" },
  { background: "bg-teal-800", foreground: "text-white" },
  { background: "bg-indigo-800", foreground: "text-white" },
  { background: "bg-red-800", foreground: "text-white" },
  { background: "bg-sky-800", foreground: "text-white" },
];

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toLocaleUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toLocaleUpperCase();
}

function colorIndex(seed: string): number {
  let hash = 0;
  for (const character of seed) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return (hash >>> 0) % colorPairs.length;
}

export default function StudentAvatar({
  studentId,
  name = "Person",
  size = 44,
  className = "",
}: StudentAvatarProps) {
  const initials = initialsFor(name);
  const colors = colorPairs[colorIndex(studentId || name)];
  const displaySize = size + 4;

  return (
    <span
      role="img"
      aria-label={`${name} initials ${initials}`}
      title={name}
      className={`inline-grid shrink-0 place-items-center rounded-full border border-white/70 font-sans font-bold uppercase leading-none tracking-wide shadow-sm ${colors.background} ${colors.foreground} ${className}`}
      style={{ width: displaySize, height: displaySize, fontSize: Math.max(11, Math.min(20, displaySize * 0.36)) }}
    >
      {initials}
    </span>
  );
}
