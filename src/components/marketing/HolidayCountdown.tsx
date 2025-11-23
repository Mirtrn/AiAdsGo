"use client";

import { useEffect, useState } from "react";
import { Timer, Gift, ShoppingBag } from "lucide-react";
import Image from "next/image";

// Import generated images (assuming they are in public or accessible via path)
// Since I cannot move files to public in this environment easily, I will use the absolute paths for now 
// or assume they are served correctly. 
// For this environment, I will use the artifact paths directly if possible, or base64 if needed.
// However, standard Next.js requires images in public. 
// I will assume for this task I can use the artifact path as a placeholder or I should have moved them.
// Wait, I should copy them to public if I want them to work in a real app.
// But I don't have access to public folder easily? 
// Let's check if I can write to public.
// The user workspace is /Users/jason/Documents/Kiro/autobb
// I should check if public exists.

type Holiday = "black-friday" | "christmas" | "none";

export function HolidayCountdown() {
    const [timeLeft, setTimeLeft] = useState({
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0,
    });
    const [holiday, setHoliday] = useState<Holiday>("none");
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        const calculateTime = () => {
            const now = new Date();
            const currentYear = now.getFullYear();

            // Black Friday 2025: Nov 28
            const blackFriday = new Date(currentYear, 10, 28); // Month is 0-indexed
            // Christmas 2025: Dec 25
            const christmas = new Date(currentYear, 11, 25);

            let targetDate: Date | null = null;
            let currentHoliday: Holiday = "none";

            if (now < blackFriday) {
                targetDate = blackFriday;
                currentHoliday = "black-friday";
            } else if (now < christmas) {
                targetDate = christmas;
                currentHoliday = "christmas";
            }

            setHoliday(currentHoliday);

            if (targetDate) {
                const difference = targetDate.getTime() - now.getTime();

                if (difference > 0) {
                    setTimeLeft({
                        days: Math.floor(difference / (1000 * 60 * 60 * 24)),
                        hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
                        minutes: Math.floor((difference / 1000 / 60) % 60),
                        seconds: Math.floor((difference / 1000) % 60),
                    });
                }
            }
        };

        calculateTime();
        const timer = setInterval(calculateTime, 1000);

        return () => clearInterval(timer);
    }, []);

    if (!mounted || holiday === "none") return null;

    const isBlackFriday = holiday === "black-friday";

    // Using the generated image paths. In a real deployment, these should be moved to public/.
    // For this demo, I'll use the absolute path which might not work in browser but works for code structure.
    // Actually, to make it work in the user's browser if they run it, I should probably try to put them in public.
    // But I'll stick to the logic first.
    // I'll use a placeholder URL or the artifact path if I can't move them.
    // Let's assume the user will handle the asset movement or I'll do it if I can find the public dir.

    // For now I will use the artifact paths as the src, knowing it might need adjustment.
    // Use a fixed version to force cache refresh for the new images
    const version = "v2";
    const bgImage = isBlackFriday
        ? `/black_friday_bg.png?v=${version}`
        : `/christmas_bg.png?v=${version}`;

    return (
        <div className="relative z-10 w-full min-h-[20vh] flex items-center justify-center overflow-hidden animate-in fade-in slide-in-from-top-4 duration-700 bg-slate-900">
            {/* Background Image */}
            <div className="absolute inset-0 z-0">
                <img
                    src={bgImage}
                    alt="Background"
                    className="w-full h-full object-cover"
                />
            </div>



            {/* Content */}
            <div className="relative z-10 flex flex-col items-center gap-2 text-white p-2 w-full max-w-4xl">
                {/* Title Section */}
                <div className="flex items-center gap-2 mb-1 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100">
                    <div className={`p-1.5 rounded-full ${isBlackFriday ? "bg-blue-500/20 border border-blue-400/30 shadow-[0_0_15px_rgba(59,130,246,0.5)]" : "bg-white/20 border border-white/30"}`}>
                        {isBlackFriday ? (
                            <ShoppingBag className="w-5 h-5 text-blue-300 drop-shadow-[0_0_8px_rgba(147,197,253,0.8)]" />
                        ) : (
                            <Gift className="w-5 h-5 text-yellow-300" />
                        )}
                    </div>
                    <span className={`font-bold text-2xl sm:text-4xl tracking-wider bg-clip-text text-transparent drop-shadow-[0_4px_4px_rgba(0,0,0,0.8)] font-sans ${isBlackFriday
                        ? "bg-gradient-to-r from-white via-yellow-200 to-white"
                        : "bg-gradient-to-r from-white via-red-200 to-white"
                        }`}>
                        {isBlackFriday ? "黑色星期五 · 购物狂欢" : "圣诞狂欢节"}
                    </span>
                </div>

                {/* Countdown Cards */}
                <div className="flex items-start justify-center gap-3 sm:gap-5 w-full animate-in fade-in slide-in-from-bottom-8 duration-700 delay-200">
                    {[
                        { value: timeLeft.days, label: "天" },
                        { value: timeLeft.hours, label: "时" },
                        { value: timeLeft.minutes, label: "分" },
                        { value: timeLeft.seconds, label: "秒" }
                    ].map((item, index) => (
                        <div key={index} className="flex flex-col items-center gap-1">
                            <div className="relative group">
                                <div className={`absolute inset-0 rounded-xl blur-md opacity-50 ${isBlackFriday ? "bg-blue-600" : "bg-red-600"}`}></div>
                                <div className="relative w-14 sm:w-20 h-16 sm:h-24 bg-white/10 backdrop-blur-md border border-white/20 rounded-xl flex items-center justify-center shadow-2xl overflow-hidden">
                                    <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent opacity-50"></div>
                                    <span className="font-mono text-3xl sm:text-5xl font-bold text-white drop-shadow-md tracking-tighter tabular-nums">
                                        {String(item.value).padStart(2, '0')}
                                    </span>
                                </div>
                            </div>
                            <span className="text-xs sm:text-sm font-bold text-white uppercase tracking-[0.2em] drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]">
                                {item.label}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
