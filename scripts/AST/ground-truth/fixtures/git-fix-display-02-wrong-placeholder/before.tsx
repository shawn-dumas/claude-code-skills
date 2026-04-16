import { Menu, MenuButton, MenuItem, MenuItems, Transition } from '@headlessui/react';
import { useAuthState } from '@/providers/context/auth';
import { mapUserRoleName, isAdmin } from '@/shared/utils';
import { InsightsPageIds } from '@/constants/testIds';
import Link from 'next/link';
import { useDropdownScrollHandler } from '@/shared/hooks';
import { getUserInitials, prettyPrintCompany } from './utils';
import { ChevronUpDownIcon } from '../Icons';
import { settingsAccountUrl } from '@/urlsRegistry';

export function ProfileMenu({ align }: { align?: 'left' | 'right' }) {
  const { logOut, userInfo, roles } = useAuthState();

  const handleLogOut = () => void logOut({ logOutType: 'manual' });

  const dropdownRef = useDropdownScrollHandler();

  if (!userInfo) return null;

  return (
    <Menu as='div' className='relative inline-flex'>
      <MenuButton
        data-testid={InsightsPageIds.USER_INFO_MENU_BUTTON}
        className='flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 border border-gray-300 transition-all shadow-xs hover:shadow cursor-pointer'
      >
        <div className='flex items-center justify-center w-7 h-7 rounded-full bg-linear-to-br from-blue-500 to-purple-600 shadow-xs group-hover:shadow-md transition-shadow duration-200'>
          <span className='text-white text-xs font-bold'>{getUserInitials(userInfo)}</span>
        </div>

        <div className='-mr-1'>
          <ChevronUpDownIcon />
        </div>
      </MenuButton>
      <Transition
        as='div'
        className={`origin-top-right z-20 absolute top-full min-w-44 bg-white border border-slate-200 py-1.5 rounded shadow-lg overflow-hidden mt-1 ${
          align === 'right' ? 'right-0' : 'left-0'
        }`}
        enter='transition ease-out duration-200 transform'
        enterFrom='opacity-0 -translate-y-2'
        enterTo='opacity-100 translate-y-0'
        leave='transition ease-out duration-200'
        leaveFrom='opacity-100'
        leaveTo='opacity-0'
      >
        <div className='px-4 py-3 bg-linear-to-r from-slate-50 to-white border-b border-slate-100'>
          <div className='flex items-center gap-3'>
            <div className='flex items-center justify-center w-8 h-8 rounded-full bg-linear-to-br from-blue-500 to-purple-600 shadow-xs'>
              <span className='text-white text-xs font-bold'>{getUserInitials(userInfo)}</span>
            </div>
            <div className='flex-1 min-w-0'>
              <div
                data-testid={InsightsPageIds.USER_INFO_MENU_COMPANY}
                title={userInfo?.company}
                className='font-semibold text-slate-900 text-sm truncate'
              >
                {prettyPrintCompany(userInfo?.company)}
              </div>
              <div
                title={userInfo?.email}
                data-testid={InsightsPageIds.USER_INFO_EMAIL}
                className='text-xs text-slate-600 truncate'
              >
                {userInfo?.email || 'N/A'}
              </div>
            </div>
          </div>
          <div data-testid={InsightsPageIds.USER_INFO_ROLE} className='mt-2 text-sm text-slate-500 font-medium'>
            {mapUserRoleName(userInfo?.role)}
          </div>
        </div>
        <MenuItems modal={false} as='ul' className='focus:outline-hidden pt-1' ref={dropdownRef}>
          {isAdmin(roles) && (
            <MenuItem as='li'>
              {({ focus }) => (
                <Link
                  data-testid={InsightsPageIds.SETTINGS_LINK_INSIGHTS_PAGE}
                  href={settingsAccountUrl().pathname}
                  className={`font-medium text-sm flex items-center py-1 px-3 ${
                    focus ? 'text-indigo-600' : 'text-indigo-500'
                  }`}
                >
                  Settings
                </Link>
              )}
            </MenuItem>
          )}
          <MenuItem as='li'>
            {({ focus }) => (
              <button
                data-testid={InsightsPageIds.USER_INFO_SIGNOUT_BUTTON}
                className={`font-medium text-sm flex items-center py-1 px-3 ${
                  focus ? 'text-indigo-600' : 'text-indigo-500'
                }`}
                onClick={handleLogOut}
              >
                Sign Out
              </button>
            )}
          </MenuItem>
        </MenuItems>
      </Transition>
    </Menu>
  );
}
