/**
 * 响应式表格操作按钮组件
 *
 * 针对移动端优化的表格操作区域：
 * - 移动端：只显示图标，隐藏文字
 * - 桌面端：显示图标+文字
 * - 使用 CSS media query 或 JavaScript 检测屏幕宽度
 */

import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface TableActionButtonProps {
  icon: React.ReactNode
  label: string
  onClick?: () => void
  variant?: "default" | "outline" | "ghost" | "destructive" | "secondary"
  size?: "sm" | "default" | "lg" | "icon"
  disabled?: boolean
  className?: string
  title?: string
}

/**
 * 单个表格操作按钮
 * - 移动端只显示图标
 * - 桌面端显示图标+文字
 */
export function TableActionButton({
  icon,
  label,
  onClick,
  variant = "ghost",
  size = "sm",
  disabled = false,
  className,
  title,
}: TableActionButtonProps) {
  return (
    <Button
      variant={variant}
      size={size}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "transition-all",
        // 默认样式
        className
      )}
      title={title || label}
    >
      {icon}
      {/* 桌面端显示文字 - 使用 hidden sm:flex 来控制显示 */}
      <span className="hidden sm:inline ml-1.5">{label}</span>
    </Button>
  )
}

interface TableActionGroupProps {
  children: React.ReactNode
  className?: string
}

/**
 * 操作按钮组
 * - 移动端：水平排列，可能换行
 * - 桌面端：水平排列，不换行
 */
export function TableActionGroup({ children, className }: TableActionGroupProps) {
  return (
    <div className={cn(
      "flex flex-wrap items-center gap-1 sm:gap-2",
      className
    )}>
      {children}
    </div>
  )
}

interface ResponsiveActionCellProps {
  primaryAction?: {
    icon: React.ReactNode
    label: string
    onClick: () => void
    disabled?: boolean
    variant?: "default" | "outline" | "ghost"
    title?: string
  }
  secondaryActions?: Array<{
    icon: React.ReactNode
    label: string
    onClick: () => void
    disabled?: boolean
    variant?: "ghost" | "destructive" | "secondary"
    className?: string
  }>
  className?: string
}

/**
 * 完整的响应式操作单元格
 * 包含一个主要操作按钮（发布广告等）和多个次要操作（下拉菜单）
 */
export function ResponsiveActionCell({
  primaryAction,
  secondaryActions,
  className,
}: ResponsiveActionCellProps) {
  return (
    <div className={cn("flex items-center gap-1 sm:gap-2", className)}>
      {/* 主要操作按钮 - 移动端可能只显示图标 */}
      {primaryAction && (
        <Button
          size="sm"
          variant={primaryAction.variant || "default"}
          onClick={primaryAction.onClick}
          disabled={primaryAction.disabled}
          className={cn(
            "h-8 whitespace-nowrap",
            // 移动端只显示图标
            "sm:pr-3"
          )}
          title={primaryAction.disabled ? '请等待数据抓取完成' : (primaryAction.title || primaryAction.label)}
        >
          {primaryAction.icon}
          {/* 桌面端显示文字 */}
          <span className="hidden sm:inline ml-1.5">{primaryAction.label}</span>
        </Button>
      )}

      {/* 次要操作按钮组 */}
      {secondaryActions && secondaryActions.length > 0 && (
        <TableActionGroup>
          {secondaryActions.map((action, idx) => (
            <TableActionButton
              key={idx}
              icon={action.icon}
              label={action.label}
              onClick={action.onClick}
              disabled={action.disabled}
              variant={action.variant || "ghost"}
              size="sm"
              className={cn("h-8 w-8 sm:w-auto sm:px-3", action.className)}
            />
          ))}
        </TableActionGroup>
      )}
    </div>
  )
}
