import { Sidebar as LeftSidebar, SidebarList as List } from '@erxes/ui/src/layout';
import { __ } from '@erxes/ui/src/utils';
import { Button } from '@erxes/ui/src/components';
import { MainStyleTopHeader as TopHeader } from '@erxes/ui/src/styles/eindex';
import React from 'react';
import { Link } from 'react-router-dom';

class Sidebar extends React.Component {
  renderListItem(url: string, text: string) {
    return (
      <li>
        <Link
          to={url}
          className={window.location.href.includes(url) ? 'active' : ''}
        >
          {__(text)}
        </Link>
      </li>
    );
  }

  render() {
    return (
      <LeftSidebar full={true}>
        <List id="SettingsSidebar">
          {this.renderListItem(
            '/erxes-plugin-sync-erkhet/settings/general',
            'General config'
          )}
          {this.renderListItem(
            '/erxes-plugin-sync-erkhet/settings/stage',
            'Stage in Ebarimt config'
          )}
          {this.renderListItem(
            '/erxes-plugin-sync-erkhet/settings/pipeline',
            'Pipeline remiainder config'
          )}
        </List>
      </LeftSidebar>
    );
  }
}

export default Sidebar;
