type LoginResponse = { accessToken: string; refreshToken?: string; user: { role: string } }

/** Lưu phiên vừa đăng nhập ở trình duyệt: localStorage cho client, cookie cho middleware. */
export function storeLoginSession(data: LoginResponse) {
  localStorage.setItem('accessToken', data.accessToken)
  localStorage.setItem('refreshToken', data.refreshToken || '')
  localStorage.setItem('user', JSON.stringify(data.user))
  document.cookie = `accessToken=${data.accessToken}; path=/; max-age=900; SameSite=Lax`
  document.cookie = `userRole=${data.user.role}; path=/; max-age=604800; SameSite=Lax`
}
