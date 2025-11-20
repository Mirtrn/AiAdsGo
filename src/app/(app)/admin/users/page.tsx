'use client'

import { useState, useEffect } from 'react'
import { Plus, MoreVertical, Edit, Trash, User as UserIcon, ChevronLeft, ChevronRight, Wand2, XCircle, CheckCircle, Search, Filter } from 'lucide-react'
import { toast } from "sonner"
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

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

    // Filters
    const [searchQuery, setSearchQuery] = useState('')
    const [roleFilter, setRoleFilter] = useState('all')
    const [statusFilter, setStatusFilter] = useState('all')

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
        const timer = setTimeout(() => {
            fetchUsers(1)
        }, 300)
        return () => clearTimeout(timer)
    }, [searchQuery, roleFilter, statusFilter])

    useEffect(() => {
        fetchUsers(pagination.page)
    }, [pagination.page])

    const fetchUsers = async (page: number = 1) => {
        try {
            setLoading(true)
            const params = new URLSearchParams({
                page: page.toString(),
                limit: pagination.limit.toString(),
                search: searchQuery,
                role: roleFilter,
                status: statusFilter
            })

            const res = await fetch(`/api/admin/users?${params}`)
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
                    <h1 className="page-title">用户管理</h1>
                    <p className="page-subtitle">管理系统用户、套餐和权限</p>
                </div>
                <Button onClick={() => setIsCreateOpen(true)} className="bg-indigo-600 hover:bg-indigo-700" aria-label="新建用户">
                    <Plus className="w-4 h-4 mr-2" />
                    新建用户
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <div className="flex flex-col sm:flex-row gap-4">
                        {/* Search */}
                        <div className="flex-1 relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="搜索用户名或邮箱..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-10"
                            />
                        </div>

                        {/* Role Filter */}
                        <Select value={roleFilter} onValueChange={setRoleFilter}>
                            <SelectTrigger className="w-[150px]">
                                <SelectValue placeholder="角色" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">所有角色</SelectItem>
                                <SelectItem value="admin">管理员</SelectItem>
                                <SelectItem value="user">普通用户</SelectItem>
                            </SelectContent>
                        </Select>

                        {/* Status Filter */}
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger className="w-[150px]">
                                <SelectValue placeholder="状态" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">所有状态</SelectItem>
                                <SelectItem value="active">正常</SelectItem>
                                <SelectItem value="disabled">禁用</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>用户</TableHead>
                                    <TableHead>角色</TableHead>
                                    <TableHead>套餐</TableHead>
                                    <TableHead>有效期</TableHead>
                                    <TableHead>状态</TableHead>
                                    <TableHead className="text-right">操作</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {users.length === 0 && !loading ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                                            未找到用户
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    users.map((user) => (
                                        <TableRow key={user.id}>
                                            <TableCell>
                                                <div className="flex items-center gap-3">
                                                    <Avatar>
                                                        <AvatarFallback className="bg-indigo-100 text-indigo-600">
                                                            {user.username.substring(0, 2).toUpperCase()}
                                                        </AvatarFallback>
                                                    </Avatar>
                                                    <div>
                                                        <div className="font-medium">{user.username}</div>
                                                        <div className="text-caption text-muted-foreground">{user.email || '无邮箱'}</div>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
                                                    {user.role === 'admin' ? '管理员' : '用户'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="capitalize">
                                                    {user.package_type}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-muted-foreground">
                                                {user.package_expires_at ? new Date(user.package_expires_at).toLocaleDateString() : '永久'}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={user.is_active ? 'outline' : 'destructive'} className={user.is_active ? 'text-green-600 border-green-600' : ''}>
                                                    {user.is_active ? '正常' : '禁用'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon">
                                                            <MoreVertical className="w-4 h-4" />
                                                        </Button>
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
                                                                    <XCircle className="w-4 h-4 mr-2" />
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
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    {/* Pagination */}
                    {pagination.totalPages > 1 && (
                        <div className="flex items-center justify-between mt-4">
                            <div className="text-sm text-muted-foreground">
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
                </CardContent>
            </Card>

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
                                <p className="text-caption text-muted-foreground">
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
                            <p className="text-caption text-muted-foreground">
                                {createPackage === 'trial' && '试用版: 当前日期 + 7天'}
                                {createPackage === 'annual' && '年度会员: 当前日期 + 365天'}
                                {(createPackage === 'lifetime' || createPackage === 'enterprise') && '终身/企业版: 2099-12-31'}
                            </p>
                        </div>
                        <div className="space-y-2">
                            <Label>邮箱地址 <span className="text-caption text-muted-foreground">(可选)</span></Label>
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
                            <Label>邮箱地址 <span className="text-caption text-muted-foreground">(可选)</span></Label>
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
