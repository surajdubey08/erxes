import * as telemetry from 'erxes-telemetry';
import * as express from 'express';
import {
  Branches,
  Configs,
  Departments,
  FieldsGroups,
  Units,
  Users
} from '../../../db/models';
import { ILink } from '@erxes/api-utils/src/types';
import {
  IDetail,
  IEmailSignature,
  IUser
} from '../../../db/models/definitions/users';
import messageBroker from '../../../messageBroker';
import { putCreateLog, putUpdateLog } from '../../logUtils';
import { resetPermissionsCache } from '../../permissions/utils';
import { checkPermission, requireLogin } from '../../permissions/wrappers';
import { IContext } from '../../types';
import utils, { authCookieOptions, getEnv, sendRequest } from '../../utils';

interface IUsersEdit extends IUser {
  channelIds?: string[];
  _id: string;
}

interface ILogin {
  email: string;
  password: string;
  deviceToken?: string;
}

const sendInvitationEmail = ({
  email,
  token
}: {
  email: string;
  token: string;
}) => {
  const MAIN_APP_DOMAIN = getEnv({ name: 'MAIN_APP_DOMAIN' });
  const confirmationUrl = `${MAIN_APP_DOMAIN}/confirmation?token=${token}`;

  utils.sendEmail({
    toEmails: [email],
    title: 'Team member invitation',
    template: {
      name: 'userInvitation',
      data: {
        content: confirmationUrl,
        domain: MAIN_APP_DOMAIN
      }
    }
  });
};

const login = async (args: ILogin, res: express.Response, secure: boolean) => {
  const response = await Users.login(args);

  const { token } = response;

  res.cookie('auth-token', token, authCookieOptions(secure));

  telemetry.trackCli('logged_in');

  return 'loggedIn';
};

const userMutations = {
  async usersCreateOwner(
    _root,
    {
      email,
      password,
      firstName,
      lastName,
      purpose,
      subscribeEmail
    }: {
      email: string;
      password: string;
      firstName: string;
      purpose: string;
      lastName?: string;
      subscribeEmail?: boolean;
    },
    { user }: IContext
  ) {
    const userCount = await Users.countDocuments();

    if (userCount > 0) {
      throw new Error('Access denied');
    }

    const doc: IUser = {
      isOwner: true,
      email: (email || '').toLowerCase().trim(),
      password: (password || '').trim(),
      details: {
        fullName: `${firstName} ${lastName || ''}`
      }
    };

    const newUser = await Users.createUser(doc);

    if (subscribeEmail && process.env.NODE_ENV === 'production') {
      await sendRequest({
        url: 'https://erxes.io/subscribe',
        method: 'POST',
        body: {
          email,
          purpose,
          firstName,
          lastName
        }
      });

      await sendRequest({
        url: 'https://api.office.erxes.io/webhooks/TfLkv6SxzkHMFT3cj',
        method: 'POST',
        headers: {
          auth: '3QuWREv4A2nzmrCJe'
        },
        body: {
          customerState: 'customer',
          customerPrimaryEmail: email,
          customerFirstName: firstName,
          customerLastName: lastName,
          customFields: [{ name: 'Customer Type', value: 'Open Source' }]
        }
      });
    }

    await Configs.createOrUpdateConfig({
      code: 'UPLOAD_SERVICE_TYPE',
      value: 'local'
    });

    await FieldsGroups.createSystemGroupsFields();

    await messageBroker().sendMessage('erxes-api:integrations-notification', {
      type: 'addUserId',
      payload: {
        _id: newUser._id
      }
    });

    await putCreateLog(
      {
        type: 'user',
        description: 'create user',
        object: newUser,
        newData: doc
      },
      user
    );

    return 'success';
  },
  /*
   * Login
   */
  async login(_root, args: ILogin, { res, requestInfo }: IContext) {
    return login(args, res, requestInfo.secure);
  },

  async logout(_root, _args, { res, user, requestInfo }: IContext) {
    const loggedout = await Users.logout(
      user,
      requestInfo.cookies['auth-token']
    );
    res.clearCookie('auth-token');
    return loggedout;
  },

  /*
   * Send forgot password email
   */
  async forgotPassword(_root, { email }: { email: string }) {
    const token = await Users.forgotPassword(email);

    // send email ==============
    const MAIN_APP_DOMAIN = getEnv({ name: 'MAIN_APP_DOMAIN' });

    const link = `${MAIN_APP_DOMAIN}/reset-password?token=${token}`;

    await utils.sendEmail({
      toEmails: [email],
      title: 'Reset password',
      template: {
        name: 'resetPassword',
        data: {
          content: link
        }
      }
    });

    return 'sent';
  },

  /*
   * Reset password
   */
  async resetPassword(_root, args: { token: string; newPassword: string }) {
    return Users.resetPassword(args);
  },

  /*
   * Reset member's password
   */
  usersResetMemberPassword(_root, args: { _id: string; newPassword: string }) {
    return Users.resetMemberPassword(args);
  },

  /*
   * Change user password
   */
  usersChangePassword(
    _root,
    args: { currentPassword: string; newPassword: string },
    { user }: IContext
  ) {
    return Users.changePassword({ _id: user._id, ...args });
  },

  /*
   * Update user
   */
  async usersEdit(_root, args: IUsersEdit, { user }: IContext) {
    const { _id, channelIds, ...doc } = args;
    const userOnDb = await Users.getUser(_id);

    const updatedUser = await Users.updateUser(_id, doc);

    await resetPermissionsCache();

    await putUpdateLog(
      {
        type: 'user',
        description: 'edit profile',
        object: userOnDb,
        newData: doc,
        updatedDocument: updatedUser
      },
      user
    );

    return updatedUser;
  },

  /*
   * Edit user profile
   */
  async usersEditProfile(
    _root,
    {
      username,
      email,
      password,
      details,
      links
    }: {
      username: string;
      email: string;
      password: string;
      details: IDetail;
      links: ILink;
    },
    { user }: IContext
  ) {
    const userOnDb = await Users.getUser(user._id);

    const valid = await Users.comparePassword(password, userOnDb.password);

    if (!password || !valid) {
      // bad password
      throw new Error('Invalid password. Try again');
    }

    const doc = {
      username,
      email,
      details,
      links
    };
    const updatedUser = Users.editProfile(user._id, doc);

    await putUpdateLog(
      {
        type: 'user',
        description: 'edit profile',
        object: userOnDb,
        newData: doc,
        updatedDocument: updatedUser
      },
      user
    );

    return updatedUser;
  },

  /*
   * Set Active or inactive user
   */
  async usersSetActiveStatus(
    _root,
    { _id }: { _id: string },
    { user }: IContext
  ) {
    if (user._id === _id) {
      throw new Error('You can not delete yourself');
    }

    const updatedUser = await Users.setUserActiveOrInactive(_id);
    await putUpdateLog(
      {
        type: 'user',
        description: 'changed status',
        object: updatedUser,
        updatedDocument: updatedUser
      },
      user
    );

    return updatedUser;
  },

  /*
   * Invites users to team members
   */
  async usersInvite(
    _root,
    {
      entries
    }: {
      entries: Array<{
        email: string;
        password: string;
        groupId: string;
        channelIds?: string[];
        unitId?: string;
        branchId?: string;
        departmentId?: string;
      }>;
    },
    { user }: IContext
  ) {
    for (const entry of entries) {
      await Users.checkDuplication({ email: entry.email });

      const token = await Users.invite(entry);
      const createdUser = await Users.findOne({ email: entry.email });

      if (entry.unitId) {
        await Units.updateOne(
          { _id: entry.unitId },
          { $push: { userIds: createdUser?._id } }
        );
      }

      if (entry.branchId) {
        await Branches.updateOne(
          { _id: entry.branchId },
          { $push: { userIds: createdUser?._id } }
        );
      }

      if (entry.departmentId) {
        await Departments.updateOne(
          { _id: entry.departmentId },
          { $push: { userIds: createdUser?._id } }
        );
      }

      sendInvitationEmail({ email: entry.email, token });

      await putCreateLog(
        {
          type: 'user',
          description: 'invited user',
          object: createdUser,
          newData: createdUser || {}
        },
        user
      );
    }

    await resetPermissionsCache();
  },

  /*
   * Resend invitation
   */
  async usersResendInvitation(_root, { email }: { email: string }) {
    const token = await Users.resendInvitation({ email });

    sendInvitationEmail({ email, token });

    return token;
  },

  async usersConfirmInvitation(
    _root,
    {
      token,
      password,
      passwordConfirmation,
      fullName,
      username
    }: {
      token: string;
      password: string;
      passwordConfirmation: string;
      fullName?: string;
      username?: string;
    }
  ) {
    const user = await Users.confirmInvitation({
      token,
      password,
      passwordConfirmation,
      fullName,
      username
    });

    await messageBroker().sendMessage('erxes-api:integrations-notification', {
      type: 'addUserId',
      payload: {
        _id: user._id
      }
    });

    await putUpdateLog(
      {
        type: 'user',
        description: 'confirm invitation',
        object: user,
        updatedDocument: user
      },
      user
    );
    return user;
  },

  usersConfigEmailSignatures(
    _root,
    { signatures }: { signatures: IEmailSignature[] },
    { user }: IContext
  ) {
    return Users.configEmailSignatures(user._id, signatures);
  },

  usersConfigGetNotificationByEmail(
    _root,
    { isAllowed }: { isAllowed: boolean },
    { user }: IContext
  ) {
    return Users.configGetNotificationByEmail(user._id, isAllowed);
  }
};

requireLogin(userMutations, 'usersChangePassword');
requireLogin(userMutations, 'usersEditProfile');
requireLogin(userMutations, 'usersConfigGetNotificationByEmail');
requireLogin(userMutations, 'usersConfigEmailSignatures');

checkPermission(userMutations, 'usersEdit', 'usersEdit');
checkPermission(userMutations, 'usersInvite', 'usersInvite');
checkPermission(userMutations, 'usersResendInvitation', 'usersInvite');
checkPermission(userMutations, 'usersSetActiveStatus', 'usersSetActiveStatus');
checkPermission(userMutations, 'usersResetMemberPassword', 'usersEdit');

export default userMutations;
