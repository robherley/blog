---
title: "🏡 Homelab III: Automation with Ansible and Hardening Access"
date: 2022-01-11T00:00:00-05:00
draft: false
tags:
  - proxmox
  - ansible
  - ssh
---

In the previous part of this series, I created a two-node Proxmox cluster along with redundant (ZFS) and shared (NFS) storage. In this part, I'll go over how to connect to the host machines with Ansible, harden access, and setup some minor user management. This'll all be through an automatic, idempotent configuration process.

## What is Ansible?

Ansible is a great automation platform from Red Hat (they bought AnsibleWorks), and it's an extremely popular tool making it a great learning exercise for the homelab. It has an agentless architecture, so it's super simple to setup only requiring an SSH connection. I'll use my laptop to manage Ansible to the controlled machines. In a "real world" environment, this would typically be done on a [bastion](https://en.wikipedia.org/wiki/Bastion_host).

## Installing Ansible locally

Ansible can most likely be found on [your favorite package manager](https://docs.ansible.com/ansible/latest/installation_guide/intro_installation.html#installing-ansible-on-specific-operating-systems), but it can also be installed via [`pip`](https://docs.ansible.com/ansible/latest/installation_guide/intro_installation.html#installing-and-upgrading-ansible-with-pip). We'll be making [playbooks](https://docs.ansible.com/ansible/latest/user_guide/playbooks_intro.html) to handle some of the automation of our homelab.

## Adding SSH keys for controlled access

Since Ansible is agentless and uses SSH, each machine will need minor config changes for the initial access. Using password authentication for SSH generally isn't a good idea, so SSH key verification will be used. The [`ssh-import-id`](http://manpages.ubuntu.com/manpages/focal/man1/ssh-import-id.1.html) utility is great for this, it can pull public keys from sources like [GitHub](https://github.com/) or [Canonical Launchpad](https://launchpad.net/) and add them to an authorized keys file. So for each machine (including the Pi) public SSH keys will need to be added. Most cloud providers facilitate this with [cloud-init](https://cloud-init.io/) where any SSH public keys and other first time setup is configured after provision, so machines can be wired up to automation like Ansible without any manual intervention. Later in this guide, cloud-init will be used upon VM creation. But for the current baremetal hosts, a one time manual SSH and pull will suffice:

{{< terminal >}}
root@r720$ apt install import-ssh-id
root@r720$ ssh-import-id-gh robherley
{{< /terminal >}}

{{< terminal >}}
root@nuc$ apt install import-ssh-id
root@nuc$ ssh-import-id-gh robherley
{{< /terminal >}}

{{< terminal >}}
pi@piprimary$ sudo apt install import-ssh-id
pi@piprimary$ ssh-import-id-gh robherley
{{< /terminal >}}

Tedious right? Luckily that's the last time each host will need to be manually accessed.

## Ansible directory, configuration and inventory

Ansible loves being [organized](https://docs.ansible.com/ansible/2.3/playbooks_best_practices.html#content-organization), but some of the recommendations are overkill for my size of a homelab. This homelab will be condensed to mostly just playbooks, avoiding roles altogether. This directory is hosted on GitHub at [robherley/homelab](https://github.com/robherley/homelab/tree/main/ansible).

Within an `ansible` directory, start by making an extremely basic `ansible.cfg`. This'll set some defaults for any of the Ansible commands:

```ini
[defaults]
inventory=inventory ; the inventory directory
vault_password_file=.vault_password ; password used for encrypting private values
private_key_file=~/.ssh/id_ed25519_gmail ; path to SSH private key
```

Then, make a `.vault_password` file. This is the password that'll be used to encrypt secrets with [Ansible Vault](https://docs.ansible.com/ansible/latest/user_guide/vault.html). That way, configuration can be commited to git without worrying about sensitive data (like passwords) being exposed. But it's also important to __*not commit*__ this file to git with the rest of the configuration. This'll just be a plaintext file that contains a password, ie:

```
correct-horse-battery-staple
```

Next is the `inventory` directory, with a `hosts` file inside of it. An [inventory](https://docs.ansible.com/ansible/latest/user_guide/intro_inventory.html) is a very important construct in Ansible, it's a grouped list of the managed machines and some metadata on how to access them. The r720 and the NUC will be in a `proxmox` group, and the Raspberry Pi in a group of it's own called `pi`:

```ini
[proxmox]
r720 ansible_host=192.168.1.100 ansible_user=root
nuc ansible_host=192.168.1.200 ansible_user=root

[pi]
piprimary ansible_host=192.168.1.254 ansible_user=pi

; note: all hosts are implicitly in the "all" group as well!
```

Notice how the different Ansible users need to be specified, and some are even using the root user. It's better practice to have users that can escalate their priviledges when necessary (instead of `root` directly), so that'll change that in a bit.

To test that all the configuration is working, the Ansible group `all` can be pinged:

{{< terminal >}}
rob@macbook$ ansible all -m ping
nuc | SUCCESS => {
    "ansible_facts": {
        "discovered_interpreter_python": "/usr/bin/python3"
    },
    "changed": false,
    "ping": "pong"
}
r720 | SUCCESS => {
    "ansible_facts": {
        "discovered_interpreter_python": "/usr/bin/python3"
    },
    "changed": false,
    "ping": "pong"
}
piprimary | SUCCESS => {
    "ansible_facts": {
        "discovered_interpreter_python": "/usr/bin/python"
    },
    "changed": false,
    "ping": "pong"
}
{{< /terminal >}}

Great! All of the hosts are reachable. Time to start writing some playbooks.

## Playbooks

Playbooks are simply a set of tasks that need to run on hosts. The following playbooks will handle repeated tasks across the machines.

### Fixing proxmox repositories

By default, Proxmox attempts to use a paid `pve-enterprise` repository for its Debian packages. Luckily these can be switched out to the free `pve-no-subscription` packages. These are noted as "less stable" than the enterpise packages, but this is a homelab after all. You can read more about the Proxmox packages [on their wiki](https://pve.proxmox.com/wiki/Package_Repositories).

In `ansible/playbooks/patch-proxmox.yml`:

```yml
- name: patch-proxmox
  become: yes
  hosts:
    - proxmox
  tasks:
    - name: add pve-no-subscription repository
      apt_repository:
        repo: deb http://download.proxmox.com/debian/pve {{ ansible_distribution_release }} pve-no-subscription
        state: present
        update_cache: no
    - name: remove pve-enterprise repository
      apt_repository:
        repo: deb https://enterprise.proxmox.com/debian/pve {{ ansible_distribution_release }} pve-enterprise
        state: absent
        update_cache: no
    - name: update pkg cache and dist-upgrade
      apt:
        update_cache: yes
        upgrade: 'dist'
```

For the playbook `patch-proxmox.yml` above, it'll run three tasks on the `proxmox` group of hosts (the `r720` and `nuc`):

1. Add the Proxmox `pve-no-subscription` debian repo based on the host's distribution release.
2. Remove the Proxmox `pve-enterprise` debian repo.
3. Run `apt update && apt dist-upgrade`.

To run the playbook:

{{< terminal >}}
rob@macbook$ ansible-playbook ./playbooks/patch-proxmox.yml
{{< /terminal >}}

💡 Ansible has some great documentations on the [builtin modules](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/index.html) such as the [`apt`](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/apt_module.html#ansible-collections-ansible-builtin-apt-module) and [`apt_repository`](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/apt_repository_module.html#ansible-collections-ansible-builtin-apt-repository-module) modules used in the tasks above.

### Add a sudoer

As mentioned before, the `root` user is being used on the Proxmox hosts and `pi` user on the Raspberry Pi. It would be better to have a common known user as an entrypoint for automation, which is what the following playbook will do.

In `ansible/playbooks/setup-sudoers.yml`:

```yml
- name: add sudoers with ssh keys
  hosts:
    - proxmox
    - pi
  become: yes
  gather_facts: no
  vars:
    users:
      - name: rob
        github: robherley
        password: $6$himalayan$E.K7G4g7NoIW69HLpmK1QDU1JMN4aaSYPOOGX1SwoSl.uqr64JruCEeDH0nLi9CxJR1/2HGTnTDVKfCC2ubub1
  tasks:
    - name: add sudo
      apt:
        name: sudo
        state: present
    - name: add user
      user:
        name: "{{ item.name }}"
        password: "{{ item.password }}"
        shell: /bin/bash
      with_items: "{{ users }}"
    - name: enable passwordless sudo
      lineinfile:
        dest: /etc/sudoers.d/99-ansible-users
        state: present
        mode: 0440
        create: yes
        regexp: '^{{ item.name }}'
        line: '{{ item.name }} ALL=(ALL) NOPASSWD: ALL'
        validate: 'visudo -cf %s'
      with_items: "{{ users }}"
    - name: add keys from github
      authorized_key:
        key: "https://github.com/{{ item.github }}.keys"
        user: "{{ item.name }}"
      with_items: "{{ users }}"
```

For both the `pi` and `proxmox` host groups, it'll do the following:

1. Make sure `sudo` is present on the machines.
2. Enable passwordless sudo for any user in the `sudo` group. The `lineinfile` also has a handy validation function which will validate the changes on a temporary file before overwriting. This way the sudoers file doesn't accidentally get borked.
3. For every `item` in the `users` var, create a user with `item.name`. The contents for `item.password` end up _exact_ in `/etc/shadow`, so it must be hashed and salted beforehand. To do this, it can be generated with `openssl passwd -6 -salt <salt> <password>`.
4. For every `item` in the `users` var, add authorized keys from GitHub based on the `item.github` key. This is similar to previous steps with `ssh-import-id`, but this is adding the public keys for the newly created user.

And then run the playbook:

{{< terminal >}}
rob@macbook$ ansible-playbook ./playbooks/setup-sudoers.yml
{{< /terminal >}}

Now, all the machines should be accessible at `rob@<host>`, without using a password and with the ability to escalate to root.

The `ansible_user` attributes can now be removed from the `inventory` file:

```diff
[proxmox]
- r720 ansible_host=192.168.1.100 ansible_user=root
+ r720 ansible_host=192.168.1.100
- nuc ansible_host=192.168.1.200 ansible_user=root
+ nuc ansible_host=192.168.1.200

[pi]
- piprimary ansible_host=192.168.1.254 ansible_user=pi
+ piprimary ansible_host=192.168.1.254
```

And set the default remote user in `ansible.cfg`:

```diff
[defaults]
inventory=inventory
vault_password_file=.vault_password
private_key_file=~/.ssh/id_ed25519_gmailkey
+ remote_user=rob
```

Then verify that the remotes are still reachable with `ansible all -m ping`. If this command fails, the configuration is incorrect.

### Harden SSH

Now that there's a separate user as an entrypoint (with SSH keys), `root` access can be disabled* as well as password access for SSH:

In `ansible/playbooks/harden-ssh.yml`:

```yml
- name: harden ssh connection
  become: yes
  hosts:
    - proxmox
    - pi
  tasks:
    - name: assert non-root user
      assert:
        that:
          - ansible_user != "root"
        fail_msg: "must run this playbook as non-root to ensure SSH works"
        success_msg: "successfully connected as non-root!"
    - name: disable password login
      lineinfile:
        dest: /etc/ssh/sshd_config
        state: present
        regexp: '^PasswordAuthentication'
        line: 'PasswordAuthentication no'
        validate: 'sshd -t -f %s'
      notify:
        - restart-sshd
    - name: disable root login
      when: "'proxmox' not in group_names"
      lineinfile:
        dest: /etc/ssh/sshd_config
        state: present
        regexp: '^PermitRootLogin'
        line: 'PermitRootLogin no'
        validate: 'sshd -t -f %s'
      notify:
        - restart-sshd
  handlers:
    - name: restart-sshd
      service:
        name: sshd
        state: restarted
```

For both the `pi` and `proxmox` host groups, it'll do the following:

1. A basic assert on the current `ansible_user` to make sure it isn't using root to connect.
2. Disabling password login for ssh, and validating with `sshd -t`.
3. Disabling root login for ssh, and validating with `sshd -t`. Note there's a special `when` statement checking if the current host is in the `proxmox` group. *We want to leave root login enabled for these, since Proxmox requires root SSH for the web console shell access and for live migration.

💡 These tasks also use a [`handler`](https://docs.ansible.com/ansible/latest/user_guide/playbooks_handlers.html) to execute an additional action only after the task has _changed_. In the case above, anytime we the sshd configuration changes, the service is restarted.

And to run the playbook:

{{< terminal >}}
rob@macbook$ ansible-playbook ./playbooks/harden-ssh.yml
{{< /terminal >}}

Now, SSH access via `root` is locked for non-Proxmox hosts:

{{< terminal >}}
rob@macbook$ ssh root@192.168.1.254
root@192.168.1.254: Permission denied (publickey).
{{< /terminal >}}

But it is accessible via the new user and can escalate when necessary:
{{< terminal >}}
rob@macbook$ ssh rob@192.168.1.254
rob@piprimary$ id
uid=1000(rob) gid=1001(rob) groups=1001(rob)
rob@piprimary$ sudo su - # escalate with no password required!
root@piprimary$
{{< /terminal >}}

## Next

All of the groundwork for homelab automation is now in place, and easily extendable. In the next part, I'll dive deeper into automated Proxmox management and container templating.