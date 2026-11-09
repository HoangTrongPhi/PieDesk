/**
 * Who made PieDesk and how to reach them, shown in About & contact (Manager sidebar).
 * Same card as the Abyss apps (Poseidon, Coral); PieDesk keeps its own copy since it doesn't use @abyss/ui.
 * Empty fields are hidden; links open in the default browser / mail app.
 */
export interface AuthorLink {
  label: string;
  /** `https://…` or `mailto:…` only. */
  url: string;
  kind: "linkedin" | "artstation" | "github" | "youtube" | "facebook" | "web" | "cv";
}

export interface Author {
  name: string;
  handle: string;
  role: string;
  location: string;
  bio: string;
  availability: string;
  website: string;
  email: string;
  skills: string[];
  highlights: { title: string; studio: string; years: string }[];
  links: AuthorLink[];
  cv: string;
}

export const AUTHOR: Author = {
  name: "Hoàng Trọng Phi",
  handle: "Phineas",
  role: "3D Technical Artist",
  location: "Ho Chi Minh City, Vietnam",
  bio: "Environments, optimization and VR/XR across Unreal, Unity and Meta Horizon, and the pipeline tools that keep the assets flowing.",
  availability: "Open to full-time roles and freelance projects",
  website: "https://huang-fei-room-porfolio.vercel.app/",
  email: "",
  skills: ["Unreal", "Unity", "Meta Horizon", "Cocos", "Web 3D", "VR/XR", "Optimization"],
  highlights: [
    { title: "Lies of P", studio: "Neowiz / Round8 Studio", years: "2021 – 2023" },
    { title: "Caliverse", studio: "Lotte", years: "2021 – 2023" },
    { title: "Net Surfer, Oblique BeatSaber", studio: "Meta Horizon Worlds", years: "2026" },
  ],
  links: [
    { label: "LinkedIn", url: "https://www.linkedin.com/in/hoangtrongphi2511/", kind: "linkedin" },
    { label: "ArtStation", url: "https://www.artstation.com/hoangphi", kind: "artstation" },
    { label: "GitHub", url: "https://github.com/HoangTrongPhi", kind: "github" },
    { label: "YouTube", url: "https://www.youtube.com/@phihoang1825/videos", kind: "youtube" },
    { label: "Facebook", url: "https://www.facebook.com/phi.hoang.568294/", kind: "facebook" },
  ],
  cv: "https://drive.google.com/file/d/1ew7p4o9LU8ICZqbRo4OMR2Ul2i61Cpie/view?usp=drive_link",
};
