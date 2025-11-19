'use client'

import { useState, useEffect } from 'react'
import { Plus, MoreVertical, Edit, Trash, User as UserIcon, ChevronLeft, ChevronRight, Wand2, Ban, CheckCircle } from 'lucide-react'
import { toast } from "sonner"
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// 动物名列表用于生成用户名
const ANIMAL_NAMES = [
    'wolf', 'eagle', 'tiger', 'lion', 'bear', 'fox', 'hawk', 'deer', 'owl', 'swan',
    'panda', 'koala', 'lynx', 'otter', 'raven', 'falcon', 'cobra', 'whale', 'shark', 'phoenix',
    'dragon', 'panther', 'jaguar', 'leopard', 'cheetah', 'gazelle', 'antelope', 'buffalo', 'bison', 'moose',
    'elk', 'zebra', 'giraffe', 'hippo', 'rhino', 'camel', 'llama', 'alpaca', 'rabbit', 'squirrel'
]

const ADJECTIVES = [
    'bold', 'swift', 'wise', 'brave', 'calm', 'keen', 'noble', 'proud', 'quick', 'sharp',
    'agile', 'clever', 'mighty', 'silent', 'steady', 'fierce', 'gentle', 'loyal', 'cosmic', 'stellar'
]
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'

interface User {
    id: number
    username: string
    email: string
    role: string
    package_type: string
    package_expires_at: string | null
    is_active: number
    created_at: string
}

interface Pagination {
    total: number
    page: number
    limit: number
    totalPages: number
}

export default function UserManagementPage() {
    const [users, setUsers] = useState<User[]>([])
    const [loading, setLoading] = useState(true)
    const [pagination, setPagination] = useState<Pagination>({
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 0
    })
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [isEditOpen, setIsEditOpen] = useState(false)
    const [selectedUser, setSelectedUser] = useState<User | null>(null)

    // Create Form State
    const [createUsername, setCreateUsername] = useState('')
    const [createEmail, setCreateEmail] = useState('')
    const [createPackage, setCreatePackage] = useState('trial')
    const [createExpiry, setCreateExpiry] = useState('')

    // 根据套餐类型计算过期时间
    const calculateExpiryDate = (packageType: string): string => {
        const today = new Date()
        let expiryDate: Date

        switch (packageType) {
            case 'trial':
                expiryDate = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000) // +7天
                break
            case 'annual':
                expiryDate = new Date(today.getTime() + 365 * 24 * 60 * 60 * 1000) // +365天
                break
            case 'lifetime':
            case 'enterprise':
                expiryDate = new Date('2099-12-31')
                break
            default:
                expiryDate = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)
        }

        return expiryDate.toISOString().split('T')[0]
    }

    // 自动生成唯一用户名
    const generateUsername = async () => {
        const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
        const animal = ANIMAL_NAMES[Math.floor(Math.random() * ANIMAL_NAMES.length)]
        const number = Math.floor(Math.random() * 900) + 100 // 100-999
        const username = `${adjective}${animal}${number}`

        // 检查用户名是否已存在
        try {
            const res = await fetch(`/api/admin/users?search=${username}`)
            const data = await res.json()
            const exists = data.users?.some((u: User) => u.username === username)

            if (exists) {
                // 如果存在，递归重新生成
                generateUsername()
            } else {
                setCreateUsername(username)
            }
        } catch {
            // 如果检查失败，仍然设置用户名
            setCreateUsername(username)
        }
    }

    // 当套餐类型改变时自动更新过期时间
    const handlePackageChange = (value: string) => {
        setCreatePackage(value)
        setCreateExpiry(calculateExpiryDate(value))
    }

    // 初始化时设置默认过期时间
    useEffect(() => {
        if (isCreateOpen && !createExpiry) {
            setCreateExpiry(calculateExpiryDate(createPackage))
        }
    }, [isCreateOpen])

    // Edit Form State
    const [editEmail, setEditEmail] = useState('')
    const [editPackage, setEditPackage] = useState('')
    const [editExpiry, setEditExpiry] = useState('')
    const [editStatus, setEditStatus] = useState(1)

    useEffect(() => {
        fetchUsers(pagination.page)
    }, [pagination.page])

    const fetchUsers = async (page: number = 1) => {
        try {
            setLoading(true)
            const res = await fetch(`/api/admin/users?page=${page}&limit=${pagination.limit}`)
            if (!res.ok) throw new Error('Failed to fetch users')
            const data = await res.json()
            setUsers(data.users)
            setPagination(data.pagination)
        } catch (error) {
            toast.error('加载用户列表失败')
        } finally {
            setLoading(false)
        }
    }

    const handleCreateUser = async () => {
        if (!createUsername) {
            toast.error('请先生成用户名')
            return
        }
        if (!createExpiry) {
            toast.error('请选择过期时间')
            return
        }

        try {
            const res = await fetch('/api/admin/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: createUsername,
                    email: createEmail || null,
                    packageType: createPackage,
                    packageExpiresAt: createExpiry
                })
            })

            const data = await res.json()
            if (!res.ok) throw new Error(data.error)

            toast.success(`用户创建成功! 用户名: ${data.user.username}, 默认密码: ${data.defaultPassword}`)
            setIsCreateOpen(false)
            fetchUsers(pagination.page)
            // Reset form
            setCreateUsername('')
            setCreateEmail('')
            setCreatePackage('trial')
            setCreateExpiry('')
        } catch (error: any) {
            toast.error(error.message)
        }
    }

    const handleEditUser = async () => {
        if (!selectedUser) return

        try {
            const res = await fetch(`/api/admin/users/${selectedUser.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: editEmail || null,
                    packageType: editPackage,
                    packageExpiresAt: editExpiry || null,
                    isActive: editStatus
                })
            })

            const data = await res.json()
            if (!res.ok) throw new Error(data.error)

            toast.success('用户信息更新成功')
            setIsEditOpen(false)
            fetchUsers(pagination.page)
        } catch (error: any) {
            toast.error(error.message)
        }
    }

    const handleDisableUser = async (userId: number, username: string, currentStatus: number) => {
        const action = currentStatus === 1 ? '禁用' : '启用'
        if (!confirm(`确定要${action}用户 "${username}" 吗？`)) return

        try {
            const res = await fetch(`/api/admin/users/${userId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    isActive: currentStatus === 1 ? 0 : 1
                })
            })

            const data = await res.json()
            if (!res.ok) throw new Error(data.error)

            toast.success(`用户已${action}`)
            fetchUsers(pagination.page)
        } catch (error: any) {
            toast.error(error.message)
        }
    }

    const handleDeleteUser = async (userId: number, username: string) => {
        if (!confirm(`⚠️ 确定要永久删除用户 "${username}" 吗？\n\n此操作不可恢复！所有相关数据将被删除。`)) return

        try {
            const res = await fetch(`/api/admin/users/${userId}`, {
                method: 'DELETE'
            })

            const data = await res.json()
            if (!res.ok) throw new Error(data.error)

            toast.success('用户已永久删除')
            fetchUsers(pagination.page)
        } catch (error: any) {
            toast.error(error.message)
        }
    }

    const openEditModal = (user: User) => {
        setSelectedUser(user)
        setEditEmail(user.email || '')
        setEditPackage(user.package_type)
        setEditExpiry(user.package_expires_at ? new Date(user.package_expires_at).toISOString().split('T')[0] : '')
        setEditStatus(user.is_active)
        setIsEditOpen(true)
    }

    return (
        <div className="p-8 space-y-8">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white">用户管理</h1>
                    <p className="text-slate-500 mt-2">管理系统用户、套餐和权限</p>
                </div>
                <Button onClick={() => setIsCreateOpen(true)} className="bg-indigo-600 hover:bg-indigo-700" aria-label="新建用户">
                    <Plus className="w-4 h-4 mr-2" />
                    新建用户
                </Button>
            </div>

            {/* User List */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400">
                            <tr>
                                <th className="px-6 py-4 font-medium">用户</th>
                                <th className="px-6 py-4 font-medium">角色</th>
                                <th className="px-6 py-4 font-medium">套餐</th>
                                <th className="px-6 py-4 font-medium">有效期</th>
                                <th className="px-6 py-4 font-medium">状态</th>
                                <th className="px-6 py-4 font-medium text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                            {users.map((user) => (
                                <tr key={user.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                                                <UserIcon className="w-4 h-4" />
                                            </div>
                                            <div>
                                                <div className="font-medium text-slate-900 dark:text-white">{user.username}</div>
                                                <div className="text-xs text-slate-500">{user.email}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
                                            {user.role}
                                        </Badge>
                                    </td>
                                    <td className="px-6 py-4">
                                        <Badge variant="outline" className="capitalize">
                                            {user.package_type}
                                        </Badge>
                                    </td>
                                    <td className="px-6 py-4 text-slate-500">
                                        {user.package_expires_at ? new Date(user.package_expires_at).toLocaleDateString() : '永久'}
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className={`flex items-center gap-2 ${user.is_active ? 'text-green-600' : 'text-red-600'}`}>
                                            <div className={`w-2 h-2 rounded-full ${user.is_active ? 'bg-green-600' : 'bg-red-600'}`} />
                                            {user.is_active ? '正常' : '禁用'}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger className="h-8 w-8 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-md inline-flex items-center justify-center" aria-label="操作菜单">
                                                <MoreVertical className="w-4 h-4" />
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onClick={() => openEditModal(user)}>
                                                    <Edit className="w-4 h-4 mr-2" />
                                                    编辑
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    className={user.is_active ? 'text-orange-600' : 'text-green-600'}
                                                    onClick={() => handleDisableUser(user.id, user.username, user.is_active)}
                                                >
                                                    {user.is_active ? (
                                                        <>
                                                            <Ban className="w-4 h-4 mr-2" />
                                                            禁用
                                                        </>
                                                    ) : (
                                                        <>
                                                            <CheckCircle className="w-4 h-4 mr-2" />
                                                            启用
                                                        </>
                                                    )}
                                                </DropdownMenuItem>
                                                <DropdownMenuItem className="text-red-600" onClick={() => handleDeleteUser(user.id, user.username)}>
                                                    <Trash className="w-4 h-4 mr-2" />
                                                    删除
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {pagination.totalPages > 1 && (
                    <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 dark:border-slate-700">
                        <div className="text-sm text-slate-500">
                            显示 {(pagination.page - 1) * pagination.limit + 1} - {Math.min(pagination.page * pagination.limit, pagination.total)} 条，共 {pagination.total} 条
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                                disabled={pagination.page === 1 || loading}
                            >
                                <ChevronLeft className="w-4 h-4 mr-1" />
                                上一页
                            </Button>
                            <div className="flex items-center gap-1">
                                {Array.from({ length: pagination.totalPages }, (_, i) => i + 1).map((pageNum) => {
                                    // 显示逻辑：当前页、前后各1页、第一页、最后一页
                                    const showPage =
                                        pageNum === 1 ||
                                        pageNum === pagination.totalPages ||
                                        Math.abs(pageNum - pagination.page) <= 1

                                    if (!showPage && pageNum === 2 && pagination.page > 3) {
                                        return <span key={pageNum} className="px-2 text-slate-400">...</span>
                                    }
                                    if (!showPage && pageNum === pagination.totalPages - 1 && pagination.page < pagination.totalPages - 2) {
                                        return <span key={pageNum} className="px-2 text-slate-400">...</span>
                                    }
                                    if (!showPage) return null

                                    return (
                                        <Button
                                            key={pageNum}
                                            variant={pagination.page === pageNum ? 'default' : 'outline'}
                                            size="sm"
                                            onClick={() => setPagination(prev => ({ ...prev, page: pageNum }))}
                                            disabled={loading}
                                            className="min-w-[36px]"
                                        >
                                            {pageNum}
                                        </Button>
                                    )
                                })}
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                                disabled={pagination.page === pagination.totalPages || loading}
                            >
                                下一页
                                <ChevronRight className="w-4 h-4 ml-1" />
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* Create User Modal */}
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>新建用户</DialogTitle>
                        <DialogDescription>
                            创建一个新用户账号。默认密码为 auto11@20ads
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>用户名 <span className="text-red-500">*</span></Label>
                            <div className="flex gap-2">
                                <Input
                                    placeholder="点击自动生成按钮生成用户名"
                                    value={createUsername}
                                    onChange={(e) => setCreateUsername(e.target.value)}
                                    className="flex-1"
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={generateUsername}
                                    className="shrink-0"
                                >
                                    <Wand2 className="w-4 h-4 mr-2" />
                                    自动生成
                                </Button>
                            </div>
                            {createUsername && (
                                <p className="text-xs text-muted-foreground">
                                    生成的用户名: <span className="font-medium text-foreground">{createUsername}</span>
                                </p>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label>套餐类型 <span className="text-red-500">*</span></Label>
                            <Select value={createPackage} onValueChange={handlePackageChange}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="trial">试用版 (Trial)</SelectItem>
                                    <SelectItem value="annual">年度会员 (Annual)</SelectItem>
                                    <SelectItem value="lifetime">终身会员 (Lifetime)</SelectItem>
                                    <SelectItem value="enterprise">私有化部署 (Enterprise)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>过期时间 <span className="text-red-500">*</span></Label>
                            <Input
                                type="date"
                                value={createExpiry}
                                onChange={(e) => setCreateExpiry(e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">
                                {createPackage === 'trial' && '试用版: 当前日期 + 7天'}
                                {createPackage === 'annual' && '年度会员: 当前日期 + 365天'}
                                {(createPackage === 'lifetime' || createPackage === 'enterprise') && '终身/企业版: 2099-12-31'}
                            </p>
                        </div>
                        <div className="space-y-2">
                            <Label>邮箱地址 <span className="text-slate-400 text-xs">(可选)</span></Label>
                            <Input
                                placeholder="user@example.com"
                                value={createEmail}
                                onChange={(e) => setCreateEmail(e.target.value)}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsCreateOpen(false)}>取消</Button>
                        <Button onClick={handleCreateUser} disabled={!createUsername || !createExpiry}>创建用户</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Edit User Modal */}
            <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>编辑用户</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>邮箱地址 <span className="text-slate-400 text-xs">(可选)</span></Label>
                            <Input
                                type="email"
                                placeholder="user@example.com"
                                value={editEmail}
                                onChange={(e) => setEditEmail(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>套餐类型</Label>
                            <Select value={editPackage} onValueChange={setEditPackage}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="trial">试用版 (Trial)</SelectItem>
                                    <SelectItem value="annual">年度会员 (Annual)</SelectItem>
                                    <SelectItem value="lifetime">终身会员 (Lifetime)</SelectItem>
                                    <SelectItem value="enterprise">私有化部署 (Enterprise)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>过期时间</Label>
                            <Input
                                type="date"
                                value={editExpiry}
                                onChange={(e) => setEditExpiry(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>账号状态</Label>
                            <Select value={String(editStatus)} onValueChange={(v) => setEditStatus(Number(v))}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="1">正常</SelectItem>
                                    <SelectItem value="0">禁用</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsEditOpen(false)}>取消</Button>
                        <Button onClick={handleEditUser}>保存更改</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
