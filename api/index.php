<?php
// api/index.php — single-entry REST router for the EraMaster backend.
// All requests go to api/index.php?action=... (GET for reads, POST for writes).
//
// The actual endpoint logic lives in api/handlers/, grouped by domain, so no
// single file is more than a few hundred lines:
//   handlers/auth.php           signup, login/logout, session, 2FA
//   handlers/records.php        get_all / set_all (generic module data)
//   handlers/users_roles.php    user accounts + role/permission editor
//   handlers/audit_security.php audit log, security log, session registry
//   handlers/approvals.php      the multi-step approval workflow engine
//   handlers/portal.php         parent & student portal endpoints
//   handlers/slideshow.php      homepage photo slideshow (public read, admin save)
//   handlers/logo.php           school logo upload (settings.manage); URL is returned by school_profile
//   handlers/broadcast.php      Messaging broadcasts: in-app notification to a target group (no e-mail)
//   handlers/chat.php           live staff chat (channels, messages, feedback, end session)
//   handlers/marks.php          teacher "Enter Marks" (one subject, one class; creates the exam if needed)
//   handlers/profile.php        My Profile for every role (staff / student / parent)
//   handlers/admissions.php     public online applications + staff review (Application Details)
//   handlers/notify.php         in-app notifications for every role (bell), written by the server when things happen
//   handlers/dataimport.php     dynamic Data Import: any CSV / Excel / JSON file, auto-detected, previewed, stored flexibly

require __DIR__ . '/config.php';
require __DIR__ . '/data.php';

require __DIR__ . '/handlers/auth.php';
require __DIR__ . '/handlers/records.php';
require __DIR__ . '/handlers/users_roles.php';
require __DIR__ . '/handlers/audit_security.php';
require __DIR__ . '/handlers/approvals.php';
require __DIR__ . '/handlers/portal.php';
require __DIR__ . '/handlers/slideshow.php';
require __DIR__ . '/handlers/broadcast.php';
require __DIR__ . '/handlers/logo.php';
require __DIR__ . '/handlers/chat.php';
require __DIR__ . '/handlers/marks.php';
require __DIR__ . '/handlers/profile.php';
require __DIR__ . '/handlers/admissions.php';
require __DIR__ . '/handlers/notify.php';
require __DIR__ . '/handlers/dataimport.php';

$action = $_GET['action'] ?? '';

// CSRF defence: every write must carry a custom header, which a foreign
// website cannot add to a cross-site request without a CORS preflight.
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST' && ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'EraMaster') {
    respond(['ok' => false, 'error' => 'Blocked: missing X-Requested-With header.'], 403);
}

// RELEASE THE SESSION LOCK. PHP locks the session file for the whole request, so one slow request (mail-server
// check, big import, broadcast) froze every other request from the same browser - the "system not responding" symptom.
// Only these actions change $_SESSION; every other action just reads it, so the lock is released right here.
// ($_SESSION stays readable after session_write_close(); last_seen/started_at were already saved by config.php.)
$sessionWriters = ['signup', 'signup_student', 'signup_parent', 'login', 'logout'];
if (!in_array($action, $sessionWriters, true) && session_status() === PHP_SESSION_ACTIVE) {
    session_write_close();
}
// Long-running bulk actions may exceed the default 30 s query limit set in config.php.
if (strpos($action, 'import_') === 0 || strpos($action, 'broadcast_send') === 0) {
    try { $pdo->exec("SET statement_timeout = '300s'"); } catch (Throwable $e) { /* keep default */ }
}

switch ($action) {
    case 'signup':          signup();         break;
    case 'signup_student':  signupStudent();  break;
    case 'signup_parent':   signupParent();   break;
    case 'login':           login();          break;
    case 'logout':          logout();         break;
    case 'social_providers': socialProviders(); break;
    case 'social_pending':   socialPending();   break;
    case 'me':              me();             break;
    case 'change_password': changePassword(); break;
    case 'totp_setup':      totpSetup();      break;
    case 'totp_enable':     totpEnable();     break;
    case 'totp_disable':    totpDisable();    break;

    case 'marks_save':      marksSave();      break;

    case 'get_all':         getAll();         break;
    case 'set_all':         setAll();         break;

    case 'list_users':      listUsers();      break;
    case 'create_user':     createUser();     break;
    case 'set_user_role':   setUserRole();    break;
    case 'reset_password':  resetPassword();  break;
    case 'delete_user':     deleteUser();     break;

    case 'roles_list':      rolesList();      break;
    case 'role_save':       roleSave();       break;
    case 'role_delete':     roleDelete();     break;

    case 'audit_list':      auditList();      break;
    case 'security_list':   securityList();   break;
    case 'sessions_list':   sessionsList();   break;
    case 'session_revoke':  sessionRevoke();  break;
    case 'set_user_status': setUserStatus();  break;

    case 'approvals_list':  approvalsList();  break;
    case 'approval_create': approvalCreate(); break;
    case 'approval_act':    approvalAct();    break;
    case 'approval_cancel': approvalCancel(); break;

    case 'apply_info':   applyInfo();   break;
    case 'apply_submit': applySubmit(); break;
    case 'apply_track':  applyTrack();  break;
    case 'apply_doc':    applyDoc();    break;
    case 'notif_list':   notifList();   break;
    case 'adm_list':     admList();     break;
    case 'adm_get':      admGet();      break;
    case 'adm_doc':      admDoc();      break;
    case 'adm_action':   admAction();   break;
    case 'adm_edit':     admEdit();     break;

    case 'profile_get':           profileGet();          break;
    case 'profile_update':        profileUpdate();       break;
    case 'profile_photo':         profilePhoto();        break;

    case 'portal_data':           portalData();          break;
    case 'portal_inquiry':        portalInquiry();       break;
    case 'portal_link':           portalLink();          break;
    case 'school_profile':        schoolProfile();       break;
    case 'portal_update_profile': portalUpdateProfile(); break;
    case 'portal_upload_photo':   portalUploadPhoto();   break;

    case 'slideshow':             slideshowPublic();     break;
    case 'slideshow_save':        slideshowSave();       break;

    case 'logo_save':             logoSave();            break;

    case 'broadcast_preview':     broadcastPreview();    break;
    case 'broadcast_send':        broadcastSend();       break;
    case 'broadcast_send_due':    broadcastSendDue();    break;

    case 'import_preview':       importPreview();      break;
    case 'import_commit':        importCommit();       break;
    case 'import_datasets':      importDatasets();     break;
    case 'import_rows':          importRows();         break;
    case 'import_update':        importUpdate();       break;
    case 'import_delete':        importDelete();       break;
    case 'import_export':        importExport();       break;

    case 'notif_feed':           notifFeed();          break;
    case 'notif_read':           notifRead();          break;
    case 'notif_clear':          notifClear();         break;

    case 'chat_channels':        chatChannels();       break;
    case 'chat_staff':           chatStaff();          break;
    case 'chat_channel_create':  chatChannelCreate();  break;
    case 'chat_add_members':     chatAddMembers();     break;
    case 'chat_poll':            chatPoll();           break;
    case 'chat_send':            chatSend();           break;
    case 'chat_feedback':        chatFeedback();       break;
    case 'chat_clear_mine':      chatClearMine();      break;
    case 'chat_end':             chatEnd();            break;
    case 'chat_restart':         chatRestart();        break;

    default:
        respond(['ok' => false, 'error' => 'Unknown action'], 404);
}
