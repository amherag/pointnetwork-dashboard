#!/bin/bash

# Use this command to run Point Installer:
#
# wget -qO- pointer.sh | wget

###############
## Constants ##
###############

RED='\033[0;31m'
NC='\033[0m' # No color.

# Make sure 'nvm' comes first than 'node'.
CMDS=('git' 'wget' 'curl' 'nvm' 'node' 'docker' 'docker-compose')
export POINT_DIR="$HOME/.point"
export SRC_DIR="$POINT_DIR/src"
export SRC_PN_DIR="$SRC_DIR/pointnetwork"
export SRC_DASHBOARD_DIR="$SRC_DIR/pointnetwork-dashboard"
export SOFTWARE_DIR="$POINT_DIR/software"
export LIVE_DIR="$POINT_DIR/live"
DIRS=("$POINT_DIR" "$SRC_DIR" "$SOFTWARE_DIR" "$LIVE_DIR")
## Most major distros support this:
DISTRO=$(awk -F= '/^ID=/{print $2}' /etc/os-release)

fail() {
  printf '%s\n' "$1" >&2  ## Send message to stderr. Exclude >&2 if you don't want it that way.
  exit "${2-1}"  ## Return a code specified by $2 or 1 by default.
}

###############
##     OS    ##
###############

case "$OSTYPE" in
  linux*)   export PN_OS="LINUX" ;; # or WSL
  darwin*)  export PN_OS="MAC" ;;
  win*)     export PN_OS="WIN"; fail "Don't run this script under Windows" ;;
#  msys*)    echo "MSYS / MinGW / Git Bash" ;;
#  cygwin*)  echo "Cygwin" ;;
#  bsd*)     echo "BSD" ;;
#  solaris*) echo "Solaris" ;;
  *)        fail "unknown OS TYPE: $OSTYPE" ;;
esac

is_mac() {
  if [[ "$PN_OS" == "MAC" ]]; then
    return 0
  else
    return 1
  fi
}

is_linux() {
  if [[ "$PN_OS" == "LINUX" ]]; then
    return 0
  else
    return 1
  fi
}

###############
## Functions ##
###############

ask() {
    local prompt default reply

    if [[ ${2:-} = 'Y' ]]; then
        prompt='Y/n'
        default='Y'
    elif [[ ${2:-} = 'N' ]]; then
        prompt='y/N'
        default='N'
    else
        prompt='y/n'
        default=''
    fi

    while true; do

        # Ask the question (not using "read -p" as it uses stderr not stdout)
        echo -en "${RED}>>>${NC} $1 [$prompt] "

        # Read the answer (use /dev/tty in case stdin is redirected from somewhere else)
        read -r reply </dev/tty

        # Default?
        if [[ -z $reply ]]; then
            reply=$default
        fi

        # Check if the reply is valid
        case "$reply" in
            Y*|y*) return 0 ;;
            N*|n*) return 1 ;;
        esac

    done
}

msg() {
    echo -e "${RED}>>>${NC} $1"
}

is_all_cmds_installed() {
    for cmd in "${CMDS[@]}"; do
      if ! command -v $cmd &> /dev/null
      then
          return 1
          break
      fi
    done
    return 0
}

install() {
    msg "Installing $1"
    if is_linux; then
      sudo apt-get --assume-yes install $1
    elif is_mac; then
      brew install $1
    else
      fail "Unsupported system"
    fi
}

is_docker_group() {
    if [ $(getent group docker) ]; then
	    return 0
    fi
    return 1
}

install_docker() {
    msg "Installing docker"
    if is_linux; then
      sudo apt-get --assume-yes install apt-transport-https ca-certificates gnupg lsb-release
      sudo curl -fsSL https://download.docker.com/linux/$DISTRO/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
      echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/$DISTRO $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
      sudo apt-get update
      sudo apt-get --assume-yes install docker-ce docker-ce-cli containerd.io
      ## This is needed for not needing sudo
      if ! is_docker_group; then
        msg "Creating docker group and adding current user to it"
        sudo groupadd docker
        sudo usermod -aG docker $USER
        newgrp docker
      fi
    elif is_mac; then
      echo ">>> Warning: Docker installation is not implemented yet in mac, skipping <<<" # TODO
    else
      fail "Unsupported system"
    fi
}

install_docker_compose() {
    msg "Installing docker-compose"
    sudo curl -L "https://github.com/docker/compose/releases/download/1.29.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
}

install_nvm() {
    msg "Installing nvm"
    wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.38.0/install.sh | bash
    # . ~/.bashrc # this doesn't work (https://stackoverflow.com/questions/43659084/source-bashrc-in-a-script-not-working), so:
    ### the following is from what nvm installs into .bashrc:
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
}

install_node() {
    msg "Installing node.js"
    if command -v nvm &> /dev/null
    then
      msg "nvm is installed. Installing node.js version used by PointNetwork Dashboard"

      ## Creating directories needed by PointNetwork
      make_pn_dirs
      ## Cloning repositories
      clone_pn_dashboard

      cd $SRC_DASHBOARD_DIR || fail "Could not cd into $SRC_DASHBOARD_DIR"
      nvm install
      nvm use
    else
      msg "nvm is not installed. Installing via package manager."
      install nodejs
    fi
}

try_source_nvm() {
    if [[ -f $HOME/.nvm/nvm.sh ]]; then
	    source $HOME/.nvm/nvm.sh
    fi
}

echo_welcome() {
    if [[ ! -d ~/.point ]]; then
      msg
      msg "Welcome to PointNetwork Installer"
      msg
      msg "This script creates necessary directories inside $HOME/.point,"
      msg "installs some commands using your operating system's package manager"
      msg "and clones all the required PointNetwork repositories inside $HOME/.point/src."
      msg
      msg "By continuing, you agree to Terms of Use for Point Network (https://pointnetwork.io/pages/terms)"
      msg
      msg "The commands that this script will install are:"
      msg
      msg "${CMDS[*]}"
      msg
      if ask "Do you want to continue?"; then
          msg
      fi
    fi
}

make_pn_dirs() {
    for dir in "${DIRS[@]}"; do
      if [[ ! -d "$dir" ]]; then
          msg "Creating $dir directory"
          mkdir -p "$dir"
      fi
    done
}

update_pn() {
    msg "Updating PointNetwork";
    git -C "$SRC_PN_DIR" pull
}

update_pn_dashboard() {
    msg "Updating PointNetwork Dashboard";
    git -C "$SRC_DASHBOARD_DIR" pull
}

is_pn_installed() {
    if [[ -d "$SRC_PN_DIR" ]]; then
	    return 0
    fi
    return 1
}

is_pn_dashboard_installed() {
    if [[ -d "$SRC_DASHBOARD" ]]; then
	    return 0
    fi
    return 1
}

is_all_pn_installed() {
    if is_pn_installed && is_pn_dashboard_installed; then
    	return 0
    fi
    return 1
}

clone_pn() {
    if ! is_pn_installed; then
      msg "Cloning PointNetwork";
      git clone https://github.com/pointnetwork/pointnetwork "$SRC_PN_DIR"
    fi
}

clone_pn_dashboard() {
    if ! is_pn_dashboard_installed; then
      msg "Cloning PointNetwork Dashboard";
      git clone https://github.com/pointnetwork/pointnetwork-dashboard "$SRC_DASHBOARD_DIR"
    fi
    cd "$SRC_DASHBOARD_DIR"
}

run_pn_dashboard() {
    cd "$SRC_DASHBOARD_DIR"
    msg "Installing required node.js version"
    nvm install
    msg "Changing to required node.js version"
    nvm use
    msg "Installing required node.js packages using npm"
    npm install
    msg "Starting PointNetwork Dashboard"
    npm start
}

is_all_installed() {
    if is_all_pn_installed && is_all_cmds_installed; then
      msg
      msg "Congratulations, you have all the necessary components to run PointNetwork!"
      msg ""
      msg
    else
      fail "Something is wrong. Not all commands are installed. Please check the logs"
    fi
}

maybe_update_package_manager() {
    if ! is_all_cmds_installed
    then
      msg "Updating list of available packages in package manager."
      msg
      if ! sudo apt-get update ; then
          fail "There was an error while trying to update list of available packages."
      fi
    fi
}

install_commands() {
    for cmd in "${CMDS[@]}"; do
      if ! command -v $cmd &> /dev/null
      then
          case $cmd in
            "nvm")
                install_nvm
                ;;
            "node")
                install_node
                ;;
            "docker")
                install_docker
                ;;
            "docker-compose")
                install_docker_compose
                ;;
            *)
                install $cmd
                ;;
          esac
      fi
    done
}

## Welcome message
echo_welcome

## If nvm has already been installed, we need to source it.
try_source_nvm

## Checking if we'll need to install some commands.
## If we do, let's update list of packages.
maybe_update_package_manager

## Installing necessary commands, if missing.
install_commands

## Creating directories needed by PointNetwork
make_pn_dirs

## Cloning repositories
clone_pn
clone_pn_dashboard

## Update code just in case
update_pn
update_pn_dashboard

## Checking first if everything's already installed.
## In this case we can just update and run the dashboard.
is_all_installed

# Start dashboard
if ask "Do you want to run PointNetwork Dashboard?"; then
    msg
    run_pn_dashboard
fi