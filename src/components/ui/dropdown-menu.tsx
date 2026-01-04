"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

const DropdownMenuContext = React.createContext<{
    open: boolean;
    setOpen: React.Dispatch<React.SetStateAction<boolean>>;
    containerRef: React.RefObject<HTMLDivElement | null>;
}>({
    open: false,
    setOpen: () => { },
    containerRef: { current: null },
});

const DropdownMenu = ({ children }: { children: React.ReactNode }) => {
    const [open, setOpen] = React.useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    return (
        <DropdownMenuContext.Provider value={{ open, setOpen, containerRef }}>
            <div className="relative inline-block text-left" ref={containerRef}>
                {children}
            </div>
        </DropdownMenuContext.Provider>
    );
};

import { Slot } from "@radix-ui/react-slot"

const DropdownMenuTrigger = React.forwardRef<
    HTMLButtonElement,
    React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }
>(({ className, children, asChild = false, ...props }, ref) => {
    const { open, setOpen } = React.useContext(DropdownMenuContext);
    const Comp = asChild ? Slot : "button"

    return (
        <Comp
            ref={ref}
            type={asChild ? undefined : "button"}
            onClick={() => setOpen(!open)}
            className={cn(className)}
            {...props}
        >
            {children}
        </Comp>
    );
});
DropdownMenuTrigger.displayName = "DropdownMenuTrigger";

const DropdownMenuContent = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement> & {
        align?: "start" | "end" | "center";
        side?: "top" | "bottom";
        sideOffset?: number;
    }
>(({ className, align = "center", side, sideOffset = 8, style, ...props }, forwardedRef) => {
    const { open, containerRef } = React.useContext(DropdownMenuContext);
    const contentRef = React.useRef<HTMLDivElement | null>(null);
    const [resolvedSide, setResolvedSide] = React.useState<"top" | "bottom">(side ?? "bottom");

    if (!open) return null;

    const alignmentClasses = {
        start: "left-0",
        end: "right-0",
        center: "left-1/2 -translate-x-1/2",
    };

    React.useLayoutEffect(() => {
        if (side) {
            setResolvedSide(side);
            return;
        }

        const anchorEl = containerRef.current;
        const menuEl = contentRef.current;
        if (!anchorEl || !menuEl) return;

        const anchorRect = anchorEl.getBoundingClientRect();
        const menuRect = menuEl.getBoundingClientRect();

        const viewportPadding = 8;
        const spaceBelow = window.innerHeight - anchorRect.bottom - viewportPadding;
        const spaceAbove = anchorRect.top - viewportPadding;

        // 底部空间不足时，自动向上展开，避免被分页/视口底部遮挡
        if (spaceBelow < menuRect.height && spaceAbove > spaceBelow) {
            setResolvedSide("top");
        } else {
            setResolvedSide("bottom");
        }
    }, [containerRef, open, side]);

    const sideClasses = resolvedSide === "top" ? "bottom-full" : "top-full";
    const resolvedStyle: React.CSSProperties = {
        ...style,
        marginTop: resolvedSide === "bottom" ? (style?.marginTop ?? sideOffset) : style?.marginTop,
        marginBottom: resolvedSide === "top" ? (style?.marginBottom ?? sideOffset) : style?.marginBottom,
    };

    return (
        <div
            ref={(node) => {
                contentRef.current = node;
                if (typeof forwardedRef === "function") {
                    forwardedRef(node);
                } else if (forwardedRef) {
                    (forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
                }
            }}
            className={cn(
                "absolute z-[100] min-w-[8rem] overflow-hidden rounded-md border bg-white p-1 text-gray-950 shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
                sideClasses,
                alignmentClasses[align],
                className
            )}
            style={resolvedStyle}
            {...props}
        />
    );
});
DropdownMenuContent.displayName = "DropdownMenuContent";

const DropdownMenuItem = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement> & { inset?: boolean; disabled?: boolean }
>(({ className, inset, disabled, ...props }, ref) => {
    const { setOpen } = React.useContext(DropdownMenuContext);

    return (
        <div
            ref={ref}
            className={cn(
                "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-gray-100 focus:bg-gray-100 focus:text-gray-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                inset && "pl-8",
                className
            )}
            data-disabled={disabled ? "" : undefined}
            onClick={(e) => {
                if (disabled) {
                    e.preventDefault();
                    return;
                }
                setOpen(false);
                props.onClick?.(e);
            }}
            {...props}
        />
    );
});
DropdownMenuItem.displayName = "DropdownMenuItem";

const DropdownMenuLabel = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
    <div
        ref={ref}
        className={cn(
            "px-2 py-1.5 text-sm font-semibold",
            inset && "pl-8",
            className
        )}
        {...props}
    />
));
DropdownMenuLabel.displayName = "DropdownMenuLabel";

const DropdownMenuSeparator = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
    <div
        ref={ref}
        className={cn("-mx-1 my-1 h-px bg-gray-100", className)}
        {...props}
    />
));
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";

export {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
};
