'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
export default function TermTransitionPage() { const router = useRouter(); useEffect(() => { router.replace('/organization-manager#term-transition') }, [router]); return <div className="text-sm text-[#737686]">Đang mở quản lý chuyển giao nhiệm kỳ…</div> }
