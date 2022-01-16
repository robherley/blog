---
title: "Homelab Part IV: Proxmox Dynamic Inventory and LXC Templates"
date: 2022-01-12T00:00:00-05:00
draft: false
tags:
  - proxmox
  - ansible
  - lxc
  - systemd
---

In the previous part of this series, I configured Ansible and made some basic playbooks for the homelab management. Eventually, I'll be deploying a plethora of VMs and containers, but managing a gigantic inventory every time a guest is spun up/down would be a hassle. Fortunately, there are community plugins for Ansible that allow the use of a Proxmox cluster as a [dynamic inventory](https://docs.ansible.com/ansible/latest/user_guide/intro_dynamic_inventory.html).

In this part, I'll setup some Proxmox API users for automation, setup a dynamic inventory for Proxmox guests and prepare a template for Linux containers.

## Creating an automation group and user

Permissions on Proxmox are scoped to a cluster, which is great since only need a single user is required to interact with both Proxmox nodes APIs. For a single node Proxmox installation, this'll be the exact same process. A user called `ansible` will be made in the built in [PVE realm](https://pve.proxmox.com/wiki/User_Management#pveum_authentication_realms) using the `pveum` utility. Note: for `pveum` (like most Proxmox CLI tools) must be accessed by the `root` user, so escalation (`sudo su -`) from a non-root user is required. Alternatively, these steps can also be done via the web console under Datacenter > Permissions.

On one of the Proxmox nodes:

  1. Create a group called `automation`:
{{< terminal >}}
root@r720$ pveum group add automation
{{< /terminal >}}
  2. Since this will group will be primarily for managing the entire system, it'll be assigned to the Administrator role:
{{< terminal >}}
root@r720$ pveum acl modify / --group automation --role Administrator
{{< /terminal >}}
  3. And then make the `ansible` user, add it to the automation group, and set a password:
{{< terminal >}}
root@r720$ pveum user add ansible@pve --groups automation --password <some password>
{{< /terminal >}}

## Proxmox plugin for Ansible

Ansible has a great community that develop [plugins](https://docs.ansible.com/ansible/latest/plugins/plugins.html) to extend Ansible's core functionality. Within the `community.general` collection, there's a ton of useful plugins for inventories, configurations, packages, etc. This module is usually included within the default `ansible` package, but for the sake of verbosity, a requirements file can be made:

In `ansible/requirements.yml`:

```yml
collections:
  - community.general
```

Any additional collections can be added to the requirements file. And to install them, they must be pulled from [ansible-galaxy](https://docs.ansible.com/ansible/latest/galaxy/user_guide.html):

{{< terminal >}}
rob@macbook$ ansible-galaxy install -r requirements.yml
{{< /terminal >}}

The specific plugin `community.general.proxmox` is used to configure a [dynamic inventory](https://docs.ansible.com/ansible/latest/collections/community/general/proxmox_inventory.html). There is also a [module](https://docs.ansible.com/ansible/latest/collections/community/general/proxmox_module.html) within that same plugin that can be used to manage instances within tasks.

## Proxmox as a dynamic inventory

A new inventory file will hold the configuration for the dynamic inventory:

In `ansible/inventory/proxmox.yml`:

```yml
plugin: community.general.proxmox

url: https://192.168.1.100:8006
user: ansible@pve
password: !vault |
  $ANSIBLE_VAULT;1.1;AES256
  32376266393636643961653739613661626433363062393334663432303533393337353866333633
  3630363966333562346162626466336538366532333864300a633333353237326662386466653431
  63333061353533666233313334356238323137313861363630313161613336303739663733306135
  6637663436306537650a633566343734313230343632336130623435383931333732376538383665
  64393730313335343035333966636133306639633439393434363130366466303635

validate_certs: false # enable if/when proxmox has valid certificates
want_facts: true # collect vm/container metadata as facts
want_proxmox_nodes_ansible_host: false # override `ansible_host` for node
```

The `user` and `password` are from the `ansible` user just previously configured. To get the giant encrypted block of a password, it's the following command:

{{< terminal >}}
rob@macbook$ ansible-vault encrypt_string <ansible user password>
{{< /terminal >}}

Note: Unlike the user password in the previous part of this series, this password does not need to be hashed or salted. The value is being passed as API authentication to Proxmox.

One of the great things about dynamic inventories is that they add additional groups based on specific Proxmox [_facts_](https://docs.ansible.com/ansible/latest/user_guide/playbooks_vars_facts.html). For instance, the group `proxmox_all_running` returns any VMs or containers running, which we can add to a playbook:

```yml
- name: some-playbook
  hosts:
    - proxmox_all_running
  tasks:
    ...
```

To see a list of all facts in an inventory, the following command can be used:

{{< terminal >}}
rob@macbook$ ansible-inventory --list
{{< /terminal >}}

A new LXC can be used for a quick test of the inventory. On one of the nodes, download the Ubuntu container image using [`pveam`](https://pve.proxmox.com/pve-docs/pveam.1.html) (or web console: Node > Storage > CT Templates > Templates):

{{< terminal >}}
root@r720$ pveam update
update successful
root@r720$ pveam available --section system | grep ubuntu
system          ubuntu-16.04-standard_16.04.5-1_amd64.tar.gz
system          ubuntu-18.04-standard_18.04.1-1_amd64.tar.gz
system          ubuntu-20.04-standard_20.04-1_amd64.tar.gz
system          ubuntu-21.04-standard_21.04-1_amd64.tar.gz
system          ubuntu-21.10-standard_21.10-1_amd64.tar.zst
root@r720$ pveam download rusty-dir ubuntu-20.04-standard_20.04-1_amd64.tar.gz
...
root@r720$ pveam list rusty-dir
NAME                                                         SIZE
rusty-dir:vztmpl/ubuntu-20.04-standard_20.04-1_amd64.tar.gz      204.28MB
{{< /terminal >}}

Now that the image is downloaded, time to create a container using [`pct`](https://pve.proxmox.com/pve-docs/pct.1.html) (or web console: Top Left > Create CT):

{{< terminal >}}
root@r720$ IMG_PATH='rusty-dir:vztmpl/ubuntu-20.04-standard_20.04-1_amd64.tar.gz'
root@r720$ pct create 101 $IMG_PATH --hostname tmp-ct --rootfs ssd-mirror:8 --net0 name=eth0,bridge=vmbr0,ip=dhcp --password tmp-password --start
{{< /terminal >}}

To summarize the above, a container was created with id of `101` and a hostname of `tmp-ct`. The additional configuration options are for the filesystem storage and setting up a network interface. A password will need to be set to interact with the container.

To test the Ansible setup, an interactive console is required to add a default user called `rob` with the expected SSH keys:

{{< terminal >}}
root@r720$ pct console 101 # login is `root` with the password from `pct create`
root@tmp-ct$ apt update
root@tmp-ct$ apt install ssh-import-id
root@tmp-ct$ adduser rob
root@tmp-ct$ su rob
rob@tmp-ct$ ssh-import-id-gh robherley
{{< /terminal >}}

Now, when all the Ansible hosts are pinged, the new container appears:

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
tmp-ct | SUCCESS => {
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

It can also be found under the `proxmox_all_running` group mentioned before:

{{< terminal >}}
rob@macbook$ ansible proxmox_all_running -m ping
tmp-ct | SUCCESS => {
    "ansible_facts": {
        "discovered_interpreter_python": "/usr/bin/python3"
    },
    "changed": false,
    "ping": "pong"
}
{{< /terminal >}}

Finally, the temporary container can be cleaned up:

{{< terminal >}}
root@r720$ pct stop 101
root@r720$ pct destroy 101
{{< /terminal >}}

## LXC Templates

Now would be a good time to create a template for any other Ubuntu containers that may be needed in the future.

Make a new container with specific sizing for memory and cpu:

{{< terminal >}}
root@r720$ IMG_PATH='rusty-dir:vztmpl/ubuntu-20.04-standard_20.04-1_amd64.tar.gz'
root@r720$ pct create 1000 $IMG_PATH \
--hostname ubuntu-ct-template \
--rootfs ssd-mirror:16 \
--net0 name=eth0,bridge=vmbr0,firewall=1,ip=dhcp \
--memory 4096 \
--cores 2 \
--password <root password> \
--start
{{< /terminal >}}

Similar to before, go into the container and give it the bare minimal setup for an Ansible connection. But this time, the container will need to be cleaned up so it can be templated.

Add the `ssh-import-id` package, make the `rob` user, import keys, and allow passwordless sudo:

{{< terminal >}}
root@r720$ pct console 1000
root@ubuntu-ct-template$ apt update && apt dist-upgrade
root@ubuntu-ct-template$ apt install ssh-import-id
root@ubuntu-ct-template$ apt autoremove && apt clean
root@ubuntu-ct-template$ adduser rob --shell /bin/bash
root@ubuntu-ct-template$ usermod -aG sudo rob
root@ubuntu-ct-template$ su rob
rob@ubuntu-ct-template$ ssh-import-id-gh robherley
rob@ubuntu-ct-template$ exit
root@ubuntu-ct-template$ visudo /etc/sudoers # allow passwordless sudo
{{< /terminal >}}

Now, here's a minor annoyance. When the container template is copied, it also copies all of the host keys as well, so any cloned container will have the same fingerprint. Those host keys need to be deleted:

{{< terminal >}}
root@ubuntu-ct-template$ rm /etc/ssh/ssh_host_*
{{< /terminal >}}

But, host keys will be required in order to SSH to the container. To rememdy this, I'll make a systemd service to autogenerate host keys at startup:

In `/etc/systemd/system/autohostkeys.service`:

```plaintext
[Unit]
Description=Auto Create Host Keys

[Service]
ExecStart=/usr/bin/ssh-keygen -A

[Install]
WantedBy=default.target
```

Then enable the service (but don't start it):

{{< terminal >}}
root@ubuntu-ct-template$ systemctl enable autohostkeys
{{< /terminal >}}

Finally the container can be shutdown, and converted to a template:

{{< terminal >}}
root@r720$ pct shutdown 1000
root@r720$ pct set 1000 --template 1
{{< /terminal >}}

Now, time to clone a couple containers and see if they are reachable from Ansible:

{{< terminal >}}
root@r720$ pct clone 1000 101 --full --hostname dolly1
root@r720$ pct clone 1000 102 --full --hostname dolly2
root@r720$ pct start 101
root@r720$ pct start 102
{{< /terminal >}}

And ping the Proxmox running group:

{{< terminal >}}
root@r720$ ansible proxmox_all_running -m ping
dolly2 | SUCCESS => {
    "ansible_facts": {
        "discovered_interpreter_python": "/usr/bin/python3"
    },
    "changed": false,
    "ping": "pong"
}
dolly1 | SUCCESS => {
    "ansible_facts": {
        "discovered_interpreter_python": "/usr/bin/python3"
    },
    "changed": false,
    "ping": "pong"
}
{{< /terminal >}}

And a quick double check to make sure the host keys generated properly:

{{< terminal >}}
rob@dolly1$ cat /etc/ssh/ssh_host_ecdsa_key.pub
ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBAWQVuOd8PNu88qXJ+HYevHc0mwiJ1+G1UUravyXm6tDZrxtmDvbzcOqaE2jEb10qLKRV7ILx1RKrxyHWQo2qRk= root@dolly1
rob@dolly2$ cat /etc/ssh/ssh_host_ecdsa_key.pub
ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBOEj3rEWJhb5fWv+IXtKTy3R6xtpOtMeBfAOo6Qq5/wLxoJmoh5kTekoJJ5tuTahycLhedakbY0Zxexjog8a3dY= root@dolly2
{{< /terminal >}}

Perfect, now containers can be cloned and immediately wired up to Ansible after provision. And to harden them, the new `proxmox_all_running` host group can be added to the existing playbooks.

## Next

With dynamic inventory, any Linux VM/container running in the Proxmox cluster can be seen by Ansible automatically. And with the prepared LXC templates, clones are ready to go for automation with any manual intervention. In the next part, I'll go over how to use cloud-init so the same level of automation can be achieved for virtual machine clones.