'use client'

import * as React from 'react'
import { format, subDays, startOfMonth, endOfMonth, startOfDay, endOfDay } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { Calendar as CalendarIcon, X } from 'lucide-react'
import { DateRange, DayPicker } from 'react-day-picker'
import 'react-day-picker/dist/style.css'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

export type { DateRange }

interface DateRangePickerProps {
  value?: DateRange
  onChange?: (range: DateRange | undefined) => void
  placeholder?: string
  className?: string
  variant?: 'default' | 'ghost'
  size?: 'default' | 'sm' | 'lg'
  maxDate?: Date
  minDate?: Date
  showPresets?: boolean
  showClearButton?: boolean
}

const presetRanges = [
  {
    label: '今天',
    getValue: () => ({
      from: startOfDay(new Date()),
      to: endOfDay(new Date()),
    }),
  },
  {
    label: '昨天',
    getValue: () => {
      const yesterday = subDays(new Date(), 1)
      return {
        from: startOfDay(yesterday),
        to: endOfDay(yesterday),
      }
    },
  },
  {
    label: '最近7天',
    getValue: () => ({
      from: startOfDay(subDays(new Date(), 6)),
      to: endOfDay(new Date()),
    }),
  },
  {
    label: '最近30天',
    getValue: () => ({
      from: startOfDay(subDays(new Date(), 29)),
      to: endOfDay(new Date()),
    }),
  },
  {
    label: '本月',
    getValue: () => ({
      from: startOfMonth(new Date()),
      to: endOfDay(new Date()),
    }),
  },
  {
    label: '上月',
    getValue: () => {
      const lastMonth = subDays(startOfMonth(new Date()), 1)
      return {
        from: startOfMonth(lastMonth),
        to: endOfMonth(lastMonth),
      }
    },
  },
]

export function DateRangePicker({
  value,
  onChange,
  placeholder = '选择日期范围',
  className,
  variant = 'ghost',
  size = 'sm',
  maxDate,
  minDate,
  showPresets = true,
  showClearButton = true,
}: DateRangePickerProps) {
  const [date, setDate] = React.useState<DateRange | undefined>(value)
  const [isOpen, setIsOpen] = React.useState(false)

  React.useEffect(() => {
    setDate(value)
  }, [value])

  const handleSelect = (range: DateRange | undefined) => {
    setDate(range)
    // 只有当选择了完整的日期范围时才关闭弹窗并触发 onChange
    if (range?.from && range?.to) {
      onChange?.(range)
      setIsOpen(false)
    }
  }

  const handlePresetClick = (preset: typeof presetRanges[0]) => {
    const range = preset.getValue()
    setDate(range)
    onChange?.(range)
    setIsOpen(false)
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    setDate(undefined)
    onChange?.(undefined)
  }

  const displayText = date?.from && date?.to
    ? `${format(date.from, 'yyyy-MM-dd')} ~ ${format(date.to, 'yyyy-MM-dd')}`
    : placeholder

  return (
    <div className={cn('grid gap-2', className)}>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={variant}
            size={size}
            className={cn(
              'justify-start text-left font-normal max-w-[220px]',
              !date?.from && 'text-muted-foreground',
              variant === 'ghost' && 'bg-gray-100 text-gray-600 hover:bg-gray-200',
              size === 'sm' && 'h-8 px-3 text-sm'
            )}
          >
            <CalendarIcon className="w-3.5 h-3.5 mr-1" />
            <span className="truncate">{displayText}</span>
            {showClearButton && date?.from && (
              <X
                className="w-3.5 h-3.5 ml-auto opacity-50 hover:opacity-100"
                onClick={handleClear}
              />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 z-[100]" align="start">
          <div className="flex">
            {showPresets && (
              <div className="flex flex-col gap-1 border-r p-3 pr-4">
                <div className="text-xs font-medium text-muted-foreground mb-1">快捷选择</div>
                {presetRanges.map((preset) => (
                  <Button
                    key={preset.label}
                    variant="ghost"
                    size="sm"
                    className="justify-start text-xs h-8 px-2"
                    onClick={() => handlePresetClick(preset)}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            )}
            <DayPicker
              mode="range"
              defaultMonth={date?.from}
              selected={date}
              onSelect={handleSelect}
              numberOfMonths={2}
              locale={zhCN}
              disabled={(day) => {
                if (maxDate && day > maxDate) return true
                if (minDate && day < minDate) return true
                return false
              }}
              className="p-3"
              classNames={{
                months: 'flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0',
                month: 'space-y-4',
                caption: 'flex justify-center pt-1 relative items-center',
                caption_label: 'text-sm font-medium',
                nav: 'space-x-1 flex items-center',
                nav_button: cn(
                  'h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100'
                ),
                nav_button_previous: 'absolute left-1',
                nav_button_next: 'absolute right-1',
                table: 'w-full border-collapse space-y-1',
                head_row: 'flex',
                head_cell: 'text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]',
                row: 'flex w-full mt-2',
                cell: cn(
                  'h-9 w-9 text-center text-sm p-0 relative',
                  'hover:bg-accent hover:text-accent-foreground',
                  '[&:has([aria-selected].day-range-end)]:rounded-r-md',
                  '[&:has([aria-selected].day-outside)]:bg-accent/50',
                  '[&:has([aria-selected])]:bg-accent',
                  'first:[&:has([aria-selected])]:rounded-l-md',
                  'last:[&:has([aria-selected])]:rounded-r-md',
                  'focus-within:relative focus-within:z-20'
                ),
                day: cn(
                  'h-9 w-9 p-0 font-normal aria-selected:opacity-100 rounded-md',
                  'hover:bg-accent hover:text-accent-foreground'
                ),
                day_range_start: 'day-range-start rounded-l-md',
                day_range_end: 'day-range-end rounded-r-md',
                day_selected:
                  'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground',
                day_today: 'bg-accent text-accent-foreground font-semibold',
                day_outside:
                  'day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30',
                day_disabled: 'text-muted-foreground opacity-50 cursor-not-allowed',
                day_range_middle:
                  'aria-selected:bg-accent/50 aria-selected:text-accent-foreground rounded-none',
                day_hidden: 'invisible',
              }}
            />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

