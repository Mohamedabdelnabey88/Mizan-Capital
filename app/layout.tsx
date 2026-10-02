import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'ميزان | المشاريع ورأس المال',description:'إدارة المشاريع والشراكات والسيولة والالتزامات في مساحة واحدة',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ar" dir="rtl"><body>{children}</body></html>}
