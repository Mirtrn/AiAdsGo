"use client"

import * as React from "react"
import * as ReactDOM from "react-dom"
import { cn } from "@/lib/utils"

const DropdownMenuContext = React.createContext<{
    open: boolean;
    setOpen: React.Dispatch<React.SetStateAction<boolean>>;
    triggerRef: React.RefObject<HTMLElement> | null;
}>({
    open: false,
    setOpen: () => { },
    triggerRef: null,
});

const DropdownMenu = ({ children }: { children: React.ReactNode }) => {
    const [open, setOpen] = React.useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);
    const triggerRef = React.useRef<HTMLElement>(null);

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
        <DropdownMenuContext.Provider value={{ open, setOpen, triggerRef }}>
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
    const { open, setOpen, triggerRef } = React.useContext(DropdownMenuContext);
    const Comp = asChild ? Slot : "button"

    return (
        <Comp
            ref={(node) => {
                // 合并 refs
                if (typeof ref === 'function') {
                    ref(node);
                } else if (ref) {
                    ref.current = node;
                }
                (triggerRef as React.MutableRefObject<HTMLElement | null>).current = node;
            }}
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
    React.HTMLAttributes<HTMLDivElement> & { align?: "start" | "end" | "center" }
>(({ className, align = "center", children, ...props }, ref) => {
    const { open, triggerRef } = React.useContext(DropdownMenuContext);
    const [position, setPosition] = React.useState({ top: 0, left: 0 });

    // 计算下拉菜单的位置
    React.useLayoutEffect(() => {
        if (!open || !triggerRef?.current) return;

        const triggerRect = triggerRef.current.getBoundingClientRect();
        let left = 0;

        // 根据 align 计算水平位置
        switch (align) {
            case "start":
                left = triggerRect.left;
                break;
            case "end":
                left = triggerRect.right;
                break;
            case "center":
            default:
                left = triggerRect.left + triggerRect.width / 2;
                break;
        }

        setPosition({
            top: triggerRect.bottom + window.scrollY + 8, // 8px 间距
            left: left + window.scrollX,
        });
    }, [open, align, triggerRef]);

    if (!open) return null;

    const alignmentClasses = {
        start: "",
        end: "-translate-x-full",
        center: "-translate-x-1/2",
    };

    // Portal: 将下拉菜单渲染到 body 下，避免被 overflow 容器裁剪
    const dropdownContent = (
        <div
            ref={ref}
            className={cn(
                "fixed z-[100] min-w-[8rem] overflow-hidden rounded-md border bg-white p-1 text-gray-950 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
                alignmentClasses[align],
                className
            )}
            style={{
                top: `${position.top}px`,
                left: `${position.left}px`,
            }}
            {...props}
        >
            {children}
        </div>
    );

    // 使用 Portal 渲染到 document.body
    return ReactDOM.createPortal(dropdownContent, document.body);
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
